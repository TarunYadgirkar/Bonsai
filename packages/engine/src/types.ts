/**
 * Engine contract. Shared by every surface (web app, CLI, plugin) — changing anything here is a
 * deliberate act, not a side effect.
 */

export type Role = 'user' | 'assistant';

/** Internal routing tiers. Surfaces present model + effort, never a tier name. */
export type Tier = 'quick' | 'thoughtful' | 'deep';

export type Complexity = 1 | 2 | 3;

/** Semantic class of a request, from the classifier. Routing priors are learned per kind. */
export type QuestionKind =
  | 'lookup'
  | 'synthesis'
  | 'comparison'
  | 'reasoning'
  | 'code'
  | 'creative'
  | 'other';

/** Reasoning effort, picked independently of the model. */
export type Effort = 'low' | 'medium' | 'high' | 'max';

/**
 * What the user asked for in the mode picker. Absent or `auto` means the router classifies and
 * chooses; a manual pick names both halves and skips classification.
 */
export interface ModeSelection {
  mode: 'auto' | 'manual';
  /** ModelSpec.id from models.ts. Ignored when mode is 'auto'. */
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
  /**
   * Parent message the fork was anchored to. Messages after it were out of scope at fork time —
   * compilation and later widening both respect this boundary. Absent on pre-anchor briefs.
   */
  anchorMessageId?: string;
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
  /**
   * Classifier's judgment of whether the compiled brief actually covers the question. False
   * pre-widens context before the first answer instead of paying for a doomed completion.
   * Absent when classification was skipped.
   */
  coveredByBrief?: boolean;
  /** True when the escalation ladder pulled parent context in beside the brief. */
  widened?: boolean;
  /** True when the user's learned routing priors moved the tier off the classifier's choice. */
  learned?: boolean;
  /**
   * The tier the classifier chose BEFORE any learned adjustment. Feedback must be attributed to
   * this, not `tier` — otherwise a learned down-shift's own escalations credit the shifted-to
   * tier and the bad prior never accrues counter-evidence. Absent when classification was skipped.
   */
  classifiedTier?: Tier;
  /** The classifier's semantic class for this question. Absent when classification was skipped. */
  kind?: QuestionKind;
  /** Classifier confidence 0..1 in its own read. Low confidence tempers the learned adjustment. */
  confidence?: number;
}

export interface Insight {
  id: string;
  branchId: string;
  parentId: string;
  /** The single distilled line that merges into the parent. */
  text: string;
  createdAt: string;
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
  /**
   * Persisted branch-level mode pin. Routing precedence: per-request manual mode >
   * pinnedMode > pinnedTier (legacy) > classifier. Pinning per branch — not per message —
   * also keeps the provider prompt cache warm, since resolved effort is part of the prompt.
   */
  pinnedMode?: ModeSelection | null;
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
