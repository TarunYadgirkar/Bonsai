import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { Dirent } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { POST as branchPost } from '@/app/api/branch/route';
import { POST as chatPost } from '@/app/api/chat/route';
import { POST as conversationPost } from '@/app/api/conversation/route';
import { GET as economicsGet } from '@/app/api/economics/route';
import { POST as mergePost } from '@/app/api/merge/route';
import { GET as persistenceGet } from '@/app/api/persistence/route';
import { GET as stateGet } from '@/app/api/state/route';
import type {
  BranchResponse,
  ChatResponse,
  EconomicsResponse,
  MergeResponse,
  StateResponse,
} from '@/lib/types';
import type {
  NewConversationResponse,
} from '@/app/api/conversation/route';
import type { PersistenceStatus } from '@/lib/persistence/types';
import {
  buildTree,
  listConversations,
  listLogs,
  persistenceStatus,
  rootId,
} from '@/lib/store';

const INDEPENDENT_ROOT_TITLE = 'Restart survival root';
const BRANCH_TITLE = 'Restart survival branch';
const NESTED_TITLE = 'Restart survival nested branch';
const ROOT_CHAT_CONTENT =
  'The restart contract preserves accepted tree mutations, routing evidence, and inference economics across independent processes.';
const BRANCH_QUESTION = 'Which restart evidence must remain durable across independent processes?';
const NESTED_CHAT_CONTENT = 'What durable restart evidence did this nested branch inherit?';
const MANUAL_MODE = {
  mode: 'manual' as const,
  model: 'claude-fable-5',
  effort: 'max' as const,
};

type Phase = 'write' | 'read';
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const MAX_FINGERPRINT_BYTES = 4 * 1024 * 1024;
const MAX_FINGERPRINT_ENTRIES = 512;

interface ExpectedCheckpoint {
  checkpoint: unknown;
  fingerprint: string;
}

class WorkerFailure extends Error {}

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://restart.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function responseBody<T>(label: string, response: Response): Promise<T> {
  if (!response.ok) throw new WorkerFailure(`${label} returned ${response.status}`);
  return (await response.json()) as T;
}

async function readCheckpoint(): Promise<{
  state: StateResponse;
  economics: EconomicsResponse;
  persistence: PersistenceStatus;
}> {
  const state = await responseBody<StateResponse>('state read', await stateGet());
  const economics = await responseBody<EconomicsResponse>('economics read', await economicsGet());
  const persistence = await responseBody<PersistenceStatus>(
    'persistence read',
    await persistenceGet(),
  );
  return { state, economics, persistence };
}

function publishedSnapshot(): { state: StateResponse; logs: EconomicsResponse['logs'] } {
  return {
    state: {
      rootId: rootId(),
      tree: buildTree(),
      conversations: listConversations(),
      persistence: persistenceStatus(),
    },
    logs: listLogs(),
  };
}

async function writePhase(): Promise<unknown> {
  const independentRoot = await responseBody<NewConversationResponse>(
    'conversation write',
    await conversationPost(postRequest('/api/conversation', { title: INDEPENDENT_ROOT_TITLE })),
  );
  const rootChat = await responseBody<ChatResponse>(
    'root chat',
    await chatPost(
      postRequest('/api/chat', {
        branchId: independentRoot.conversation.id,
        content: ROOT_CHAT_CONTENT,
        mode: MANUAL_MODE,
      }),
    ),
  );
  const branch = await responseBody<BranchResponse>(
    'branch write',
    await branchPost(
      postRequest('/api/branch', {
        parentId: independentRoot.conversation.id,
        selection: 'restart contract routing evidence',
        question: BRANCH_QUESTION,
        title: BRANCH_TITLE,
        mode: MANUAL_MODE,
      }),
    ),
  );
  const merge = await responseBody<MergeResponse>(
    'merge write',
    await mergePost(postRequest('/api/merge', { branchId: branch.conversation.id, archive: true })),
  );
  const nested = await responseBody<BranchResponse>(
    'nested branch write',
    await branchPost(
      postRequest('/api/branch', {
        parentId: branch.conversation.id,
        selection: 'durable restart evidence',
        title: NESTED_TITLE,
      }),
    ),
  );
  const published = publishedSnapshot();
  const checkpoint = await readCheckpoint();
  const fingerprint = await persistenceFingerprint();

  return {
    phase: 'write',
    checkpoint,
    fingerprint,
    accepted: {
      independentRoot,
      rootChat,
      branch,
      merge,
      nested,
      published,
      requests: {
        rootChatContent: ROOT_CHAT_CONTENT,
        branchQuestion: BRANCH_QUESTION,
      },
    },
  };
}

async function readPhase(): Promise<unknown> {
  const expected = await readExpectedCheckpoint();
  const fingerprint = await persistenceFingerprint();
  if (fingerprint !== expected.fingerprint) throw new WorkerFailure('checkpoint mismatch');
  const before = await readCheckpoint();
  if (!isDeepStrictEqual(before, expected.checkpoint)) {
    throw new WorkerFailure('checkpoint mismatch');
  }
  const nested = before.state.conversations.find(
    (conversation) => conversation.title === NESTED_TITLE,
  );
  if (!nested) throw new WorkerFailure('persisted nested branch is missing');

  const nestedChat = await responseBody<ChatResponse>(
    'nested chat',
    await chatPost(
      postRequest('/api/chat', {
        branchId: nested.id,
        content: NESTED_CHAT_CONTENT,
        mode: MANUAL_MODE,
      }),
    ),
  );
  const published = publishedSnapshot();
  const after = await readCheckpoint();

  return {
    phase: 'read',
    before,
    nestedChat,
    published,
    requests: { nestedChatContent: NESTED_CHAT_CONTENT },
    after,
  };
}

async function readExpectedCheckpoint(): Promise<ExpectedCheckpoint> {
  const checkpointPath = process.env.BONSAI_RESTART_CHECKPOINT_PATH;
  const dataDirectory = process.env.BONSAI_DATA_DIR;
  if (
    !checkpointPath ||
    !dataDirectory ||
    !isAbsolute(checkpointPath) ||
    !isAbsolute(dataDirectory) ||
    dirname(checkpointPath) !== dirname(dataDirectory)
  ) {
    throw new WorkerFailure('checkpoint unavailable');
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(checkpointPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const initial = await handle.stat();
    if (
      !initial.isFile() ||
      initial.nlink !== 1 ||
      initial.size <= 0 ||
      initial.size > MAX_CHECKPOINT_BYTES ||
      (initial.mode & 0o077) !== 0
    ) {
      throw new WorkerFailure('checkpoint unavailable');
    }

    const bytes = Buffer.alloc(initial.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) throw new WorkerFailure('checkpoint unavailable');
      offset += read.bytesRead;
    }
    const final = await handle.stat();
    if (final.size !== initial.size) throw new WorkerFailure('checkpoint unavailable');

    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('checkpoint' in parsed) ||
        !('fingerprint' in parsed) ||
        typeof parsed.fingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(parsed.fingerprint)
      ) {
        throw new WorkerFailure('checkpoint unavailable');
      }
      return { checkpoint: parsed.checkpoint, fingerprint: parsed.fingerprint };
    } catch {
      throw new WorkerFailure('checkpoint unavailable');
    }
  } catch (error: unknown) {
    if (error instanceof WorkerFailure) throw error;
    throw new WorkerFailure('checkpoint unavailable');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function persistenceFingerprint(): Promise<string> {
  const dataDirectory = process.env.BONSAI_DATA_DIR;
  if (!dataDirectory || !isAbsolute(dataDirectory)) {
    throw new WorkerFailure('checkpoint mismatch');
  }

  const hash = createHash('sha256');
  const budget = { bytes: 0, entries: 0 };
  try {
    const root = await lstat(dataDirectory);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw new WorkerFailure('checkpoint mismatch');
    }
    await fingerprintDirectory(dataDirectory, '', hash, budget);
    return hash.digest('hex');
  } catch (error: unknown) {
    if (error instanceof WorkerFailure) throw error;
    throw new WorkerFailure('checkpoint mismatch');
  }
}

async function fingerprintDirectory(
  directory: string,
  relativeDirectory: string,
  hash: ReturnType<typeof createHash>,
  budget: { bytes: number; entries: number },
): Promise<void> {
  const entries: Dirent[] = [];
  const directoryHandle = await opendir(directory);
  try {
    for await (const entry of directoryHandle) {
      budget.entries += 1;
      if (budget.entries > MAX_FINGERPRINT_ENTRIES) {
        throw new WorkerFailure('checkpoint mismatch');
      }
      entries.push(entry);
    }
  } finally {
    await directoryHandle.close().catch(() => undefined);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      await fingerprintDirectory(absolutePath, relativePath, hash, budget);
      continue;
    }
    if (!entry.isFile()) throw new WorkerFailure('checkpoint mismatch');
    await fingerprintFile(absolutePath, relativePath, hash, budget);
  }
}

async function fingerprintFile(
  path: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>,
  budget: { bytes: number; entries: number },
): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const initial = await handle.stat();
    budget.bytes += initial.size;
    if (
      !initial.isFile() ||
      initial.nlink !== 1 ||
      initial.size < 0 ||
      budget.bytes > MAX_FINGERPRINT_BYTES
    ) {
      throw new WorkerFailure('checkpoint mismatch');
    }
    const bytes = Buffer.alloc(initial.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) throw new WorkerFailure('checkpoint mismatch');
      offset += read.bytesRead;
    }
    const final = await handle.stat();
    if (final.size !== initial.size) throw new WorkerFailure('checkpoint mismatch');
    hash.update(`file\0${relativePath}\0${initial.size}\0`);
    hash.update(bytes);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const phase = process.argv[2] as Phase | undefined;
  if (phase !== 'write' && phase !== 'read') throw new WorkerFailure('invalid worker phase');
  const output = phase === 'write' ? await writePhase() : await readPhase();
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof WorkerFailure ? error.message : 'unexpected worker failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
