/**
 * Local brief compilation and routing — the Bonsai engine, run in the browser with zero network.
 * The engine's extractive mock (active with no API keys) pulls referent-resolved facts straight
 * from the conversation text, so the brief is built without any model call. Claude's own session
 * does the actual answering when the user sends the pre-filled branch.
 */
import {
  adjustForProfile,
  compileBrief,
  estimateTokens,
  route,
  type ContextBrief,
  type RoutingDecision,
  type RoutingProfile,
} from '@bonsai/engine';
import type { Turn } from './claude-api';

export interface CompiledBranch {
  brief: ContextBrief;
  routing: RoutingDecision;
}

function pathMarkdown(turns: Turn[]): string {
  return turns.map((t) => `${t.role}: ${t.text}`).join('\n\n');
}

/**
 * Compile a brief for a side question off the current conversation and route it. `profile` is the
 * user's learned priors (kept in extension storage) so the recommended tier personalizes over time.
 */
export async function compileBranch(params: {
  turns: Turn[];
  selection: string;
  question: string;
  profile?: RoutingProfile;
}): Promise<CompiledBranch> {
  const markdown = pathMarkdown(params.turns);
  const availableTokens = estimateTokens(markdown);

  const { brief } = await compileBrief({
    briefId: `x_${crypto.randomUUID().slice(0, 8)}`,
    branchId: `x_${crypto.randomUUID().slice(0, 8)}`,
    pathMarkdown: markdown,
    selection: params.selection,
    question: params.question || params.selection,
    availableTokens,
  });

  const routing = await route({
    question: params.question || params.selection,
    brief,
    contextTokens: brief.briefTokens,
    profile: params.profile,
  });

  return { brief, routing };
}

/** What the classifier would pick before learned priors — used to record override direction. */
export async function classifyTier(question: string, brief: ContextBrief): Promise<RoutingDecision> {
  return route({ question, brief, contextTokens: brief.briefTokens });
}

export { adjustForProfile };

/** The message pre-filled into a new claude.ai chat: the brief, then the question. */
export function branchPrompt(brief: ContextBrief, question: string): string {
  return [
    brief.markdown,
    '',
    '---',
    'Answer using only the compiled brief above. If it genuinely lacks something, say so plainly.',
    '',
    question || brief.selection,
  ].join('\n');
}

/** The message pre-filled back into the parent chat on merge — one distilled line. */
export function mergePrompt(insight: string): string {
  return `Insight from a side branch: ${insight}`;
}
