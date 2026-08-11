import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import seedConversation from '@/fixtures/seed-conversation.json';
import seedTree from '@/fixtures/seed-tree.json';
import type { PersistenceStatus } from '@/lib/persistence/types';
import type {
  BranchResponse,
  ChatResponse,
  EconomicsResponse,
  MergeResponse,
  StateResponse,
} from '@/lib/types';
import type { NewConversationResponse } from '@/app/api/conversation/route';

const execFileAsync = promisify(execFile);
const workerPath = resolve('scripts/persistence-restart-worker.ts');
const dataDirectories: string[] = [];
const EXPECTED_WRITE_PURPOSES = ['chat', 'compile', 'chat', 'merge', 'compile'];
const EXPECTED_READ_PURPOSES = [...EXPECTED_WRITE_PURPOSES, 'chat'];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Checkpoint {
  state: StateResponse;
  economics: EconomicsResponse;
  persistence: PersistenceStatus;
}

interface WriteOutput {
  phase: 'write';
  checkpoint: Checkpoint;
  fingerprint: string;
  accepted: {
    independentRoot: NewConversationResponse;
    rootChat: ChatResponse;
    branch: BranchResponse;
    merge: MergeResponse;
    nested: BranchResponse;
    published: { state: StateResponse; logs: EconomicsResponse['logs'] };
    requests: { rootChatContent: string; branchQuestion: string };
  };
}

interface ReadOutput {
  phase: 'read';
  before: Checkpoint;
  nestedChat: ChatResponse;
  published: { state: StateResponse; logs: EconomicsResponse['logs'] };
  requests: { nestedChatContent: string };
  after: Checkpoint;
}

async function runWorker<T>(
  phase: 'write' | 'read',
  dataDirectory: string,
  checkpointPath?: string,
): Promise<T> {
  const result = await execFileAsync(process.execPath, ['--import', 'tsx', workerPath, phase], {
    cwd: process.cwd(),
    env: {
      NODE_ENV: 'development',
      BONSAI_PERSISTENCE_BACKEND: 'file',
      BONSAI_DATA_DIR: dataDirectory,
      BONSAI_ROOT_ONLY_FIXTURE: '',
      VERCEL: '',
      VERCEL_ENV: '',
      VERCEL_URL: '',
      DATABASE_URL: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      XAI_API_KEY: '',
      BONSAI_MODEL_ANTHROPIC_QUICK: '',
      BONSAI_MODEL_ANTHROPIC_MID: '',
      BONSAI_MODEL_ANTHROPIC_DEEP: '',
      BONSAI_MODEL_ANTHROPIC_CEILING: '',
      BONSAI_MODEL_OPENAI_QUICK: '',
      BONSAI_MODEL_OPENAI_MID: '',
      BONSAI_MODEL_OPENAI_DEEP: '',
      BONSAI_MODEL_OPENAI_CEILING: '',
      BONSAI_MODEL_XAI_QUICK: '',
      BONSAI_MODEL_XAI_MID: '',
      BONSAI_MODEL_XAI_DEEP: '',
      BONSAI_MODEL_XAI_CEILING: '',
      NO_COLOR: '1',
      ...(checkpointPath ? { BONSAI_RESTART_CHECKPOINT_PATH: checkpointPath } : {}),
    },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result.stdout) as T;
}

afterEach(async () => {
  await Promise.all(dataDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('file persistence restart survival', () => {
  it('preserves raw persisted timestamps', async () => {
    const { dataDirectory } = await restartWorkspace();
    const written = await runWorker<WriteOutput>('write', dataDirectory);
    const timestamps = persistedTimestamps(written.checkpoint);

    expect(timestamps.length).toBeGreaterThan(0);
    expect(timestamps.every((timestamp) => ISO_TIMESTAMP.test(timestamp))).toBe(true);
  });

  it('rejects a mismatched preflight checkpoint without advancing the revision', async () => {
    const { dataDirectory, tempDirectory } = await restartWorkspace();
    const written = await runWorker<WriteOutput>('write', dataDirectory);
    const expectedPath = join(tempDirectory, 'expected-checkpoint.json');
    const mismatchedPath = join(tempDirectory, 'mismatched-checkpoint.json');
    await writeExpectedCheckpoint(expectedPath, written);
    await writePrivateJson(mismatchedPath, {
      checkpoint: {
        ...written.checkpoint,
        persistence: { ...written.checkpoint.persistence, revision: 4 },
      },
      fingerprint: written.fingerprint,
    });

    expect(await workerOutcome(dataDirectory, mismatchedPath)).toBe('checkpoint mismatch\n');

    const read = await runWorker<ReadOutput>('read', dataDirectory, expectedPath);
    expect(read.before).toEqual(written.checkpoint);
    expect(read.before.persistence.revision).toBe(5);
  });

  it('rejects a missing store without recreating it during preflight', async () => {
    const { dataDirectory, tempDirectory } = await restartWorkspace();
    const written = await runWorker<WriteOutput>('write', dataDirectory);
    const expectedPath = join(tempDirectory, 'expected-checkpoint.json');
    await writeExpectedCheckpoint(expectedPath, written);
    await rm(dataDirectory, { recursive: true });

    expect(await workerOutcome(dataDirectory, expectedPath)).toBe('checkpoint mismatch\n');
    await expect(stat(dataDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an unexpected stale file without cleaning it during preflight', async () => {
    const { dataDirectory, tempDirectory } = await restartWorkspace();
    const written = await runWorker<WriteOutput>('write', dataDirectory);
    const expectedPath = join(tempDirectory, 'expected-checkpoint.json');
    const stalePath = join(
      dataDirectory,
      '.manifest.json.1.00000000-0000-4000-8000-000000000000.tmp',
    );
    await writeExpectedCheckpoint(expectedPath, written);
    await writeFile(stalePath, '{}', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(stalePath, staleTime, staleTime);

    expect(await workerOutcome(dataDirectory, expectedPath)).toBe('checkpoint mismatch\n');
    await expect(stat(stalePath)).resolves.toMatchObject({ size: 2 });
  });

  it('detects an unrelated entry changed alongside the nested chat', () => {
    const before = [
      { id: 'fixture', value: 'preserved' },
      { id: 'nested', value: 'before' },
    ];
    const after = [
      { id: 'fixture', value: 'changed' },
      { id: 'nested', value: 'after' },
    ];

    expect(() => assertUnchangedById(before, after, new Set(['nested']), 'conversation')).toThrow(
      'unrelated conversation changed',
    );
  });

  it('streams persistence entries before enforcing the directory bound', async () => {
    const source = await readFile(workerPath, 'utf8');

    expect(source).toContain('await opendir(directory)');
    expect(source).not.toContain('await readdir(directory');
  });

  it('survives an independent process restart without fixture overwrite or semantic loss', async () => {
    const { dataDirectory, tempDirectory } = await restartWorkspace();

    const written = await runWorker<WriteOutput>('write', dataDirectory);
    const checkpointPath = join(tempDirectory, 'expected-checkpoint.json');
    await writeExpectedCheckpoint(checkpointPath, written);
    const read = await runWorker<ReadOutput>('read', dataDirectory, checkpointPath);

    expect(written.phase).toBe('write');
    expect(read.phase).toBe('read');
    expect(read.before).toEqual(written.checkpoint);
    expect(read.after.state).toEqual(read.published.state);
    expect(read.after.economics.logs).toEqual(read.published.logs);

    const { independentRoot, rootChat, branch, merge, nested, published, requests } =
      written.accepted;
    expect(written.checkpoint.state).toEqual(published.state);
    expect(written.checkpoint.economics.logs).toEqual(published.logs);
    const writtenConversations = written.checkpoint.state.conversations;
    const persistedRoot = conversationById(written.checkpoint.state, independentRoot.conversation.id);
    const persistedBranch = conversationById(written.checkpoint.state, branch.conversation.id);
    const persistedNested = conversationById(written.checkpoint.state, nested.conversation.id);

    expect(written.checkpoint.state.rootId).toBe(seedConversation.id);
    expect(writtenConversations.filter((conversation) => conversation.parentId === null)).toHaveLength(2);
    expect(writtenConversations.map((conversation) => conversation.title)).toEqual([
      seedConversation.title,
      ...seedTree.branches.map((conversation) => conversation.title),
      'Restart survival root',
      'Restart survival branch',
      'Restart survival nested branch',
    ]);
    expect(conversationById(written.checkpoint.state, seedConversation.id)).toEqual(
      {
        id: seedConversation.id,
        title: seedConversation.title,
        parentId: null,
        profile: seedConversation.profile,
        messages: seedConversation.messages,
        insights: seedTree.rootInsights,
        pinnedTier: null,
        archived: false,
      },
    );
    for (const fixtureBranch of seedTree.branches) {
      expect(conversationById(written.checkpoint.state, fixtureBranch.id)).toEqual(fixtureBranch);
    }
    expect(persistedRoot).toEqual({
      ...independentRoot.conversation,
      messages: [
        {
          id: precedingSequenceId(rootChat.message.id),
          role: 'user',
          content: requests.rootChatContent,
          createdAt: expect.stringMatching(ISO_TIMESTAMP),
        },
        rootChat.message,
      ],
      insights: [merge.insight],
    });
    expect(persistedBranch).toEqual({ ...branch.conversation, archived: true });
    expect(persistedNested).toEqual(nested.conversation);
    expect(persistedBranch.messages[0]?.content).toBe(requests.branchQuestion);

    expect(merge.insight).toMatchObject({
      branchId: branch.conversation.id,
      parentId: independentRoot.conversation.id,
      active: true,
    });
    expect(merge.insight.sourceMessageIds).toEqual(
      branch.conversation.messages.map((message) => message.id),
    );
    expect(branch.conversation.messages).toHaveLength(2);
    expect(merge.archived).toBe(true);
    expect(persistedBranch.archived).toBe(true);
    expect(persistedNested.brief?.sourceRefs).toContainEqual({
      kind: 'brief',
      conversationId: branch.conversation.id,
      sourceId: branch.brief.id,
    });

    expect(treeNode(written.checkpoint.state, independentRoot.conversation.id)).toMatchObject({
      depth: 0,
      archived: false,
      childIds: [branch.conversation.id],
    });
    expect(treeNode(written.checkpoint.state, branch.conversation.id)).toMatchObject({
      depth: 1,
      archived: true,
      childIds: [nested.conversation.id],
    });
    expect(treeNode(written.checkpoint.state, nested.conversation.id)).toMatchObject({
      depth: 2,
      archived: false,
      childIds: [],
    });

    expect(written.checkpoint.economics.logs.slice(seedTree.logs.length).map((log) => log.purpose)).toEqual(
      EXPECTED_WRITE_PURPOSES,
    );
    expect(read.after.economics.logs.slice(seedTree.logs.length).map((log) => log.purpose)).toEqual(
      EXPECTED_READ_PURPOSES,
    );
    expect(written.checkpoint.economics.totals.inferenceCount).toBe(seedTree.logs.length + 5);
    expect(read.after.economics.totals.inferenceCount).toBe(seedTree.logs.length + 6);
    expect(
      written.checkpoint.economics.logs
        .slice(seedTree.logs.length)
        .filter((log) => log.purpose === 'chat'),
    ).toHaveLength(2);
    expect(
      read.after.economics.logs
        .slice(seedTree.logs.length)
        .filter((log) => log.purpose === 'chat')
        .every(
          (log) => log.model === 'claude-fable-5' && log.effort === 'max' && log.overridden,
        ),
    ).toBe(true);
    expect(rootChat.routing).toMatchObject({
      model: 'claude-fable-5',
      effort: 'max',
      overridden: true,
      escalated: false,
    });
    expect(branch.routing).toMatchObject({
      model: 'claude-fable-5',
      effort: 'max',
      overridden: true,
      escalated: false,
    });
    expect(read.nestedChat.routing).toMatchObject({
      model: 'claude-fable-5',
      effort: 'max',
      overridden: true,
      escalated: false,
    });
    const writeLogs = written.checkpoint.economics.logs.slice(seedTree.logs.length);
    expect(writeLogs[0]).toEqual(rootChat.log);
    expect(writeLogs[2]).toMatchObject({
      branchId: branch.conversation.id,
      tier: branch.routing?.tier,
      model: branch.routing?.model,
      effort: branch.routing?.effort,
      overridden: branch.routing?.overridden,
    });
    expect(writeLogs[3]).toEqual(merge.log);
    expect(read.after.economics.logs.at(-1)).toEqual(read.nestedChat.log);

    expect(written.checkpoint.persistence).toEqual({
      backend: 'file',
      health: 'ready',
      durable: true,
      revision: 5,
    });
    expect(written.checkpoint.state.persistence).toEqual(written.checkpoint.persistence);
    expect(read.after.persistence).toEqual({
      backend: 'file',
      health: 'ready',
      durable: true,
      revision: 6,
    });
    expect(read.after.state.persistence).toEqual(read.after.persistence);

    const nestedBefore = conversationById(read.before.state, nested.conversation.id);
    const nestedAfter = conversationById(read.after.state, nested.conversation.id);
    expect(conversationById(read.after.state, branch.conversation.id).brief).toEqual(branch.brief);
    expect(
      conversationById(read.after.state, independentRoot.conversation.id).insights,
    ).toEqual([merge.insight]);
    expect(nestedAfter.brief).toEqual(nested.brief);
    const expectedNested = {
      ...nestedBefore,
      messages: [
        ...nestedBefore.messages,
        {
          id: precedingSequenceId(read.nestedChat.message.id),
          role: 'user' as const,
          content: read.requests.nestedChatContent,
          createdAt: expect.stringMatching(ISO_TIMESTAMP),
        },
        read.nestedChat.message,
      ],
    };
    expect(nestedAfter).toEqual(expectedNested);

    const nestedTreeBefore = treeNode(read.before.state, nested.conversation.id);
    const expectedNestedTree = {
      ...nestedTreeBefore,
      messageCount: nestedTreeBefore.messageCount + 2,
      lastTier: read.nestedChat.routing.tier,
    };
    expect(read.after.state.rootId).toBe(read.before.state.rootId);
    expect(read.after.state.conversations).toEqual(
      read.before.state.conversations.map((conversation) =>
        conversation.id === nested.conversation.id ? expectedNested : conversation,
      ),
    );
    expect(read.after.state.tree).toEqual(
      read.before.state.tree.map((node) =>
        node.id === nested.conversation.id ? expectedNestedTree : node,
      ),
    );
    assertUnchangedById(
      read.before.state.conversations,
      read.after.state.conversations,
      new Set([nested.conversation.id]),
      'conversation',
    );
    assertUnchangedById(
      read.before.state.tree,
      read.after.state.tree,
      new Set([nested.conversation.id]),
      'tree node',
    );
    expect(read.after.economics.logs).toEqual([
      ...read.before.economics.logs,
      read.nestedChat.log,
    ]);
    expect(read.after.economics.totals).toEqual({
      inferenceCount: read.before.economics.totals.inferenceCount + 1,
      inputTokens: read.before.economics.totals.inputTokens + read.nestedChat.log.inputTokens,
      outputTokens: read.before.economics.totals.outputTokens + read.nestedChat.log.outputTokens,
      costUsd: roundUsd(
        read.before.economics.totals.costUsd + read.nestedChat.log.estCostUsd,
      ),
    });
    const baselineInputTokens =
      read.before.economics.baseline.inputTokens + read.nestedChat.log.baselineInputTokens;
    const baselineCostUsd = roundUsd(
      read.before.economics.baseline.costUsd + read.nestedChat.log.baselineCostUsd,
    );
    expect(read.after.economics.baseline).toEqual({
      inputTokens: baselineInputTokens,
      costUsd: baselineCostUsd,
      tokensSavedPct: pctSaved(baselineInputTokens, read.after.economics.totals.inputTokens),
      costSavedPct: pctSaved(baselineCostUsd, read.after.economics.totals.costUsd),
    });
    expect(read.after.persistence.revision).toBe((read.before.persistence.revision ?? 0) + 1);
    expect(read.after.state.persistence).toEqual(read.after.persistence);
    expect(read.after.state.conversations.filter((conversation) => conversation.parentId === null)).toHaveLength(2);

    expectSequenceContinuation(written.checkpoint, seedTree.seq + 1);
    expectSequenceContinuation(read.after, seedTree.seq + 1);
  });
});

function conversationById(state: StateResponse, id: string) {
  const conversation = state.conversations.find((candidate) => candidate.id === id);
  if (!conversation) throw new Error('expected persisted conversation');
  return conversation;
}

function treeNode(state: StateResponse, id: string) {
  const node = state.tree.find((candidate) => candidate.id === id);
  if (!node) throw new Error('expected persisted tree node');
  return node;
}

function expectSequenceContinuation(checkpoint: Checkpoint, firstSuffix: number): void {
  const newIds = [
    ...checkpoint.state.conversations.slice(seedTree.branches.length + 1).flatMap((conversation) => [
      conversation.id,
      conversation.brief?.id,
      ...conversation.messages.map((message) => message.id),
      ...conversation.insights.map((insight) => insight.id),
    ]),
    ...checkpoint.economics.logs.slice(seedTree.logs.length).map((log) => log.id),
  ].filter((id): id is string => typeof id === 'string');
  const suffixes = newIds.map((id) => Number(id.slice(id.lastIndexOf('_') + 1))).sort((a, b) => a - b);

  expect(new Set(newIds).size).toBe(newIds.length);
  expect(suffixes).toEqual(
    Array.from({ length: suffixes.length }, (_, index) => firstSuffix + index),
  );
}

function precedingSequenceId(id: string): string {
  const separator = id.lastIndexOf('_');
  const suffix = Number(id.slice(separator + 1));
  return `${id.slice(0, separator)}_${suffix - 1}`;
}

async function restartWorkspace(): Promise<{
  dataDirectory: string;
  tempDirectory: string;
}> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'bonsai-restart-'));
  dataDirectories.push(tempDirectory);
  return { dataDirectory: join(tempDirectory, 'data'), tempDirectory };
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function writeExpectedCheckpoint(path: string, written: WriteOutput): Promise<void> {
  await writePrivateJson(path, {
    checkpoint: written.checkpoint,
    fingerprint: written.fingerprint,
  });
}

async function workerOutcome(dataDirectory: string, checkpointPath: string): Promise<string> {
  try {
    await runWorker('read', dataDirectory, checkpointPath);
    return 'resolved';
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || !('stderr' in error)) return 'rejected';
    return String(error.stderr);
  }
}

function persistedTimestamps(checkpoint: Checkpoint): string[] {
  return [
    ...checkpoint.state.conversations.flatMap((conversation) => [
      ...conversation.messages.flatMap((message) => message.createdAt ?? []),
      ...conversation.insights.map((insight) => insight.createdAt),
    ]),
    ...checkpoint.economics.logs.map((log) => log.ts),
  ];
}

function assertUnchangedById<T extends { id: string }>(
  before: T[],
  after: T[],
  affectedIds: ReadonlySet<string>,
  label: string,
): void {
  const beforeUnchanged = before.filter((entry) => !affectedIds.has(entry.id));
  const afterUnchanged = after.filter((entry) => !affectedIds.has(entry.id));
  if (!isDeepStrictEqual(afterUnchanged, beforeUnchanged)) {
    throw new Error(`unrelated ${label} changed`);
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function pctSaved(baseline: number, actual: number): number {
  if (baseline <= 0) return 0;
  return Math.round(((baseline - actual) / baseline) * 1000) / 10;
}
