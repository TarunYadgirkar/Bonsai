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
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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

function normalizeTimestamps(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (typeof value !== 'object') throw new WorkerFailure('unsupported checkpoint value');

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'createdAt' || key === 'ts' ? '<timestamp>' : normalizeTimestamps(entry),
    ]),
  );
}

async function writePhase(): Promise<JsonValue> {
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

  return normalizeTimestamps({
    phase: 'write',
    checkpoint,
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
  });
}

async function readPhase(): Promise<JsonValue> {
  const before = await readCheckpoint();
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

  return normalizeTimestamps({
    phase: 'read',
    before,
    nestedChat,
    published,
    requests: { nestedChatContent: NESTED_CHAT_CONTENT },
    after,
  });
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
