/**
 * The cross-conversation Bonsai tree. claude.ai has no fork-to-new-chat primitive, so the linkage
 * between a parent conversation and the branch chats it spawned lives here, in chrome.storage.local.
 * Also holds the user's learned routing profile.
 */
import { emptyProfile, type RoutingProfile } from '@bonsai/engine';

export interface TreeNode {
  id: string;
  /** claude.ai conversation uuid once the branch chat exists; null while it's just a draft. */
  conversationId: string | null;
  parentConversationId: string;
  title: string;
  selection: string;
  question: string;
  briefMarkdown: string;
  facts: string[];
  excludedNote: string;
  availableTokens: number;
  briefTokens: number;
  prunedPct: number;
  tier: string;
  model: string;
  modelLabel: string;
  effort: string;
  status: 'draft' | 'open' | 'merged' | 'abandoned';
  insight: string | null;
  createdAt: string;
}

const NODES_KEY = 'bonsai:nodes';
const PROFILE_KEY = 'bonsai:profile';

export async function listNodes(): Promise<TreeNode[]> {
  const got = await chrome.storage.local.get(NODES_KEY);
  return (got[NODES_KEY] as TreeNode[] | undefined) ?? [];
}

export async function putNode(node: TreeNode): Promise<void> {
  const nodes = await listNodes();
  const next = nodes.filter((n) => n.id !== node.id);
  next.push(node);
  await chrome.storage.local.set({ [NODES_KEY]: next });
}

export async function updateNode(id: string, patch: Partial<TreeNode>): Promise<void> {
  const nodes = await listNodes();
  await chrome.storage.local.set({
    [NODES_KEY]: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  });
}

export async function loadProfile(): Promise<RoutingProfile> {
  const got = await chrome.storage.local.get(PROFILE_KEY);
  return (got[PROFILE_KEY] as RoutingProfile | undefined) ?? emptyProfile();
}

export async function saveProfile(profile: RoutingProfile): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}
