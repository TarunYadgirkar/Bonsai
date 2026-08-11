/** Message protocol between the side panel, content script, and service worker. */
import type { ConversationTree } from './claude-api';

export type PanelToContent =
  | { type: 'GET_ACTIVE' }
  | { type: 'GET_TREE'; conversationId: string }
  | { type: 'PREFILL'; text: string };

export type ContentToPanel = { type: 'SELECTION'; text: string; conversationId: string | null };

export interface ActiveInfo {
  conversationId: string | null;
  url: string;
}

export type PrefillResult = { ok: boolean; reason?: string };
export type TreeResult = { ok: true; tree: ConversationTree } | { ok: false; reason: string };

/** Text waiting to be pre-filled into the next claude.ai composer, in storage.session. `nodeId`
 *  is set for a new branch (so the chat it becomes links back to the tree), absent for a merge. */
export interface PendingBranch {
  nodeId?: string;
  text: string;
}
export const PENDING_KEY = 'bonsai:pending';
