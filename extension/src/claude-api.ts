/**
 * Read-only bridge to claude.ai's own same-origin API. This file is the structural enforcement
 * of the human-in-the-loop rule: it exposes ONLY `get()`, and only for the conversation-read
 * path. There is no POST helper, no completion/streaming call, anywhere in the bundle — so no
 * code path can send a message or run a model on the user's behalf. The human always presses send.
 *
 * Runs in the content script's isolated world on a claude.ai tab, so fetches are same-origin and
 * the session cookie attaches automatically (no bot challenge, unlike an out-of-browser caller).
 */

const ALLOWED_PATH = /^\/api\/organizations(\/|$)/;

async function get<T>(path: string): Promise<T> {
  if (!ALLOWED_PATH.test(path)) throw new Error(`bonsai: blocked non-read path ${path}`);
  const res = await fetch(`https://claude.ai${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`claude.ai ${res.status} on ${path}`);
  return (await res.json()) as T;
}

interface Org {
  uuid: string;
}

/** Active org id: the non-HttpOnly cookie first, the org list as a fallback for multi-org users. */
export async function orgId(): Promise<string> {
  const cookie = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];
  if (cookie) return decodeURIComponent(cookie);
  const orgs = await get<Org[]>('/api/organizations');
  const id = orgs[0]?.uuid;
  if (!id) throw new Error('bonsai: no organization found');
  return id;
}

export interface ConversationSummary {
  uuid: string;
  name: string;
  updated_at: string;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const org = await orgId();
  return get<ConversationSummary[]>(`/api/organizations/${org}/chat_conversations`);
}

interface RawContentBlock {
  type: string;
  text?: string;
}

interface RawMessage {
  uuid: string;
  parent_message_uuid?: string | null;
  sender: 'human' | 'assistant';
  content?: RawContentBlock[];
  text?: string;
}

export interface RawConversation {
  uuid: string;
  name: string;
  current_leaf_message_uuid?: string;
  chat_messages?: RawMessage[];
}

export interface Turn {
  uuid: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface ConversationTree {
  uuid: string;
  name: string;
  /** The on-screen path: root → current leaf, in order. */
  path: Turn[];
}

function textOf(m: RawMessage): string {
  if (m.content?.length) {
    return m.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
  return (m.text ?? '').trim();
}

/**
 * Reconstruct the on-screen conversation path from claude.ai's raw tree: walk up from the current
 * leaf through parent_message_uuid, then reverse. Edit/retry siblings share a parent; this picks
 * the active branch only. Pure — no network — so it is unit-testable against a captured fixture.
 */
export function reconstructPath(raw: RawConversation): ConversationTree {
  const byId = new Map((raw.chat_messages ?? []).map((m) => [m.uuid, m]));
  const path: Turn[] = [];

  let cursor: RawMessage | undefined = raw.current_leaf_message_uuid
    ? byId.get(raw.current_leaf_message_uuid)
    : undefined;
  // No leaf pointer (rare): fall back to document order.
  if (!cursor) {
    for (const m of raw.chat_messages ?? []) {
      path.push({ uuid: m.uuid, role: m.sender === 'human' ? 'user' : 'assistant', text: textOf(m) });
    }
    return { uuid: raw.uuid, name: raw.name, path: path.filter((t) => t.text) };
  }
  while (cursor) {
    path.push({
      uuid: cursor.uuid,
      role: cursor.sender === 'human' ? 'user' : 'assistant',
      text: textOf(cursor),
    });
    cursor = cursor.parent_message_uuid ? byId.get(cursor.parent_message_uuid) : undefined;
  }
  return { uuid: raw.uuid, name: raw.name, path: path.reverse().filter((t) => t.text) };
}

export async function conversationTree(conversationId: string): Promise<ConversationTree> {
  const org = await orgId();
  const raw = await get<RawConversation>(
    `/api/organizations/${org}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`,
  );
  return reconstructPath(raw);
}

/** The claude.ai conversation id from a chat URL, or null off a chat page. */
export function conversationIdFromUrl(url: string): string | null {
  return /\/chat\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null;
}
