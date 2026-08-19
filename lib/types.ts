/**
 * HTTP transport contracts for the web app, plus re-exports of the engine contract so UI code
 * keeps importing from '@/lib/types'. Engine shapes live in packages/engine/src/types.ts.
 */
import type {
  BranchNode,
  Conversation,
  ContextBrief,
  EconomicsBaseline,
  EconomicsTotals,
  InferenceLog,
  Insight,
  Message,
  ModeSelection,
  RoutingDecision,
  SavingsPoint,
  SessionStats,
  Tier,
  UserProfile,
} from 'bonsai-engine';

export { PRICES_AS_OF, ceilingCostUsd } from 'bonsai-engine';

export type {
  BranchNode,
  Complexity,
  Conversation,
  ContextBrief,
  EconomicsBaseline,
  EconomicsTotals,
  Effort,
  InferenceLog,
  InferencePurpose,
  Insight,
  Message,
  ModelStats,
  ModeSelection,
  PurposeStats,
  QuestionKind,
  Role,
  RoutingDecision,
  SavingsPoint,
  SessionStats,
  Tier,
  TokenBasis,
  TokenFigure,
  UserProfile,
} from 'bonsai-engine';

/* ---------- API contracts ---------- */

/** GET /api/state — everything the UI needs to render, in one call. */
export interface StateResponse {
  rootId: string;
  tree: BranchNode[];
  conversations: Conversation[];
}

/** POST /api/chat */
export interface ChatRequest {
  branchId: string;
  content: string;
  /** Set by the UI when the user pins a tier; skips classification. */
  pinnedTier?: Tier | null;
  /** Mode picker. Overrides pinnedTier when mode is 'manual'. */
  mode?: ModeSelection;
}

export interface ChatResponse {
  branchId: string;
  message: Message;
  routing: RoutingDecision;
  log: InferenceLog;
}

/** POST /api/branch */
export interface BranchRequest {
  parentId: string;
  selection: string;
  /** Optional first question, so the branch can answer immediately on creation. */
  question?: string;
  title?: string;
  /** Mode picker, same semantics as ChatRequest. */
  mode?: ModeSelection;
  /** Parent message the selection was made in; scopes compilation to the fork point. */
  anchorMessageId?: string;
}

export interface BranchResponse {
  node: BranchNode;
  conversation: Conversation;
  brief: ContextBrief;
  /** Present only when `question` was supplied. */
  message?: Message;
  routing?: RoutingDecision;
}

/** POST /api/merge */
export interface MergeRequest {
  branchId: string;
  /** Archive the branch after merging. Defaults to true. */
  archive?: boolean;
}

export interface MergeResponse {
  insight: Insight;
  parentId: string;
  archived: boolean;
  log: InferenceLog;
  /** Parent turns added since the fork anchor — the insight predates them; disclose, don't hide. */
  parentDriftTurns?: number;
}

/** POST /api/conversation */
export interface NewConversationRequest {
  title?: string;
}

export interface NewConversationResponse {
  node: BranchNode;
  conversation: Conversation;
}

/** POST /api/message — regenerate an answer or edit-and-rerun a user turn. */
export interface MessageActionRequest {
  branchId: string;
  messageId: string;
  op: 'regenerate' | 'edit';
  content?: string;
  pinnedTier?: Tier | null;
  mode?: ModeSelection;
}

/** Same shape as ChatResponse — the replayed turn is a normal turn. */
export type MessageActionResponse = ChatResponse;

/** POST /api/node — rename or archive/unarchive a branch. */
export interface NodeActionRequest {
  id: string;
  op: 'rename' | 'archive' | 'unarchive';
  title?: string;
}

export interface NodeActionResponse {
  node: BranchNode;
  conversation: Conversation;
}

/** GET /api/economics */
export interface EconomicsResponse {
  logs: InferenceLog[];
  totals: EconomicsTotals;
  baseline: EconomicsBaseline;
  /** Rigorous aggregation with measured/estimated provenance. Additive to the original shape. */
  stats: SessionStats;
  /** Cumulative actual-vs-baseline spend per inference, for a sparkline. */
  savingsCurve: SavingsPoint[];
  /** Rows whose upstream the price catalog can't truthfully price — excluded from all $ figures. */
  unpricedCount?: number;
}

/** Every route returns this shape on failure. The app never crashes on a 4xx. */
export interface ApiError {
  error: string;
}

/* ---------- Fixture ---------- */

export interface SeedConversation {
  id: string;
  title: string;
  note: string;
  profile: UserProfile;
  messages: Message[];
}
