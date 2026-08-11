/**
 * Frozen contract (PLAN.md M0). Changing anything here requires A and B agreeing
 * out loud first, then one agent makes the change in a single commit.
 */

export type Role = 'user' | 'assistant';

/** Human-facing routing tiers. Never show model names in the UI. */
export type Tier = 'quick' | 'thoughtful' | 'deep';

export type Complexity = 1 | 2 | 3;

/**
 * Reasoning effort, picked independently of the model. Added after M0 — additive only, so every
 * pre-existing consumer still compiles (Tarun, 2026-08-07; tell Justin before he rebuilds the chip).
 */
export type Effort = 'low' | 'medium' | 'high' | 'max';

/**
 * What the user asked for in the mode picker. Absent or `auto` means the router classifies and
 * chooses; a manual pick names both halves and skips classification.
 */
export interface ModeSelection {
  mode: 'auto' | 'manual';
  /** ModelSpec.id from lib/models.ts. Ignored when mode is 'auto'. */
  model?: string;
  effort?: Effort;
}

/** Why an inference happened. Everything but 'chat' always runs on the quick tier. */
export type InferencePurpose = 'chat' | 'compile' | 'classify' | 'merge';

export interface UserProfile {
  name: string;
  context: string;
  goals: string[];
}

export type ContextSourceKind = 'profile' | 'brief' | 'message' | 'insight';

export interface ContextSourceRef {
  kind: ContextSourceKind;
  conversationId: string;
  sourceId: string;
}

export interface ContextSource extends ContextSourceRef {
  content: string;
}

export interface AssembledContext {
  markdown: string;
  sources: ContextSource[];
  tokens: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  /** Present on assistant messages produced by the engine, absent on fixture seed messages. */
  routing?: RoutingDecision;
  createdAt?: string;
}

/**
 * The compiled minimal context a branch inherits instead of its parent's history.
 * `markdown` is what actually gets sent to the model; the rest is for the UI.
 */
export interface ContextBrief {
  id: string;
  branchId: string;
  /** Text the user highlighted in the parent to spawn this branch. */
  selection: string;
  markdown: string;
  facts: string[];
  /** What was deliberately left out, stated explicitly so the model doesn't assume it has everything. */
  excludedNote: string;
  /** Token count of the full parent history this branch could have inherited. */
  availableTokens: number;
  briefTokens: number;
  /** 0-100, rounded to one decimal. Rendered on the tree edge. */
  prunedPct: number;
  sourceRefs?: ContextSourceRef[];
  factSourceIds?: string[][];
}

export interface RoutingDecision {
  tier: Tier;
  model: string;
  /** Effort actually used. Optional so pre-M5 consumers still compile; always set by the engine. */
  effort?: Effort;
  /** Display label for the chosen model, e.g. "Opus 5". Always set by the engine. */
  modelLabel?: string;
  /** What the chip should read: "Opus 5 · High effort". No tier names on the surface. */
  label?: string;
  /**
   * Upstream model that actually answered, when a live provider served it. Absent on the mock.
   * The chip keeps Bonsai's vocabulary; this is what stops it claiming a model that didn't run.
   */
  servedBy?: string;
  /** Human phrasing of reasoning effort, e.g. "low effort, single pass". */
  effortNote: string;
  contextTokens: number;
  estCostUsd: number;
  /** One sentence for the "Why did Bonsai choose this?" hover card. */
  reason: string;
  complexity: Complexity;
  escalated: boolean;
  /** True when a pinned tier or explicit user choice bypassed the classifier. */
  overridden: boolean;
}

export interface Insight {
  id: string;
  branchId: string;
  parentId: string;
  /** The single distilled line that merges into the parent. */
  text: string;
  createdAt: string;
  sourceMessageIds?: string[];
  active?: boolean;
}

/** One conversation node. The root has parentId === null and no brief. */
export interface Conversation {
  id: string;
  title: string;
  parentId: string | null;
  profile?: UserProfile;
  messages: Message[];
  brief?: ContextBrief;
  insights: Insight[];
  pinnedTier: Tier | null;
  archived: boolean;
}

/** Tree-shaped projection of a Conversation for the sidebar. Derived, never stored. */
export interface BranchNode {
  id: string;
  title: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  messageCount: number;
  pinnedTier: Tier | null;
  archived: boolean;
  /** Edge economics — null on the root, which inherits nothing. */
  availableTokens: number | null;
  inheritedTokens: number | null;
  prunedPct: number | null;
  /** Tier of the most recent assistant message, for the node badge. */
  lastTier: Tier | null;
}

export interface InferenceLog {
  id: string;
  ts: string;
  branchId: string;
  purpose: InferencePurpose;
  tier: Tier;
  model: string;
  /** Effort the call ran at. Optional for pre-M5 rows; always set by the engine now. */
  effort?: Effort;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  escalated: boolean;
  overridden: boolean;
  /** Input tokens the same request would have cost carrying full parent history. */
  baselineInputTokens: number;
  /** Cost of the same request on the deep-tier model with full history. */
  baselineCostUsd: number;
}

export interface EconomicsTotals {
  inferenceCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface EconomicsBaseline {
  /** Full-history input tokens across every logged inference. */
  inputTokens: number;
  /** Strong-model-always cost across every logged inference. */
  costUsd: number;
  tokensSavedPct: number;
  costSavedPct: number;
}

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
}

/** GET /api/economics */
export interface EconomicsResponse {
  logs: InferenceLog[];
  totals: EconomicsTotals;
  baseline: EconomicsBaseline;
}

/** Every route returns this shape on failure. The demo never crashes on a 4xx. */
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
