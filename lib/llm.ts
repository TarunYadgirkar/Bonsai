/**
 * Snowflake Cortex client. One model parameter, many models — the substrate the router needs.
 *
 * Mock mode activates automatically when SNOWFLAKE_ACCOUNT_URL or SNOWFLAKE_PAT is missing,
 * with realistic token math, so the DEMO.md script is walkable with zero keys (AGENTS.md).
 */
import { MODEL_TIERS, estimateCostUsd } from './models';
import { estimateTokens } from './tokens';
import type { Tier } from './types';

const ACCOUNT_URL = process.env.SNOWFLAKE_ACCOUNT_URL;
const PAT = process.env.SNOWFLAKE_PAT;
const ENDPOINT = '/api/v2/cortex/inference:complete';
const TIMEOUT_MS = 30_000;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteParams {
  tier: Tier;
  messages: LlmMessage[];
  /** Effort is expressed as an output-token ceiling — Cortex has no reasoning-effort knob. */
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  tier: Tier;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  /** True when the response came from the mock, not from Cortex. */
  mock: boolean;
}

export function isCortexEnabled(): boolean {
  return Boolean(ACCOUNT_URL && PAT);
}

const MAX_TOKENS_BY_TIER: Record<Tier, number> = {
  quick: 300,
  thoughtful: 700,
  deep: 1500,
};

export async function complete(params: CompleteParams): Promise<CompleteResult> {
  const { tier, messages } = params;
  const model = MODEL_TIERS[tier];
  const maxTokens = params.maxTokens ?? MAX_TOKENS_BY_TIER[tier];
  const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);

  if (!isCortexEnabled()) {
    return mockComplete(tier, model, messages, inputTokens);
  }

  try {
    const res = await fetch(`${ACCOUNT_URL}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: params.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[llm] cortex ${res.status} on ${model} — falling back to mock`);
      return mockComplete(tier, model, messages, inputTokens);
    }

    const parsed = parseCortex(await res.text());
    if (!parsed.text) {
      console.warn(`[llm] cortex returned no content on ${model} — falling back to mock`);
      return mockComplete(tier, model, messages, inputTokens);
    }

    const usedInput = parsed.inputTokens ?? inputTokens;
    const usedOutput = parsed.outputTokens ?? estimateTokens(parsed.text);
    return {
      text: parsed.text,
      model,
      tier,
      inputTokens: usedInput,
      outputTokens: usedOutput,
      estCostUsd: estimateCostUsd(tier, usedInput, usedOutput),
      mock: false,
    };
  } catch (err) {
    console.warn(`[llm] cortex failed (${(err as Error).message}) — falling back to mock`);
    return mockComplete(tier, model, messages, inputTokens);
  }
}

/**
 * Cortex may answer as one JSON object or as an SSE stream depending on account and model.
 * Both shapes are handled because we cannot verify which one this account returns until the
 * PAT lands — and the demo must not die on a parse.
 */
interface ParsedCortex {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

function parseCortex(body: string): ParsedCortex {
  const trimmed = body.trim();

  if (trimmed.startsWith('{')) {
    try {
      return extractFromJson(JSON.parse(trimmed));
    } catch {
      return { text: '' };
    }
  }

  // SSE: concatenate the content deltas, keep the last usage block we see.
  let text = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const chunk = extractFromJson(JSON.parse(payload));
      text += chunk.text;
      inputTokens = chunk.inputTokens ?? inputTokens;
      outputTokens = chunk.outputTokens ?? outputTokens;
    } catch {
      // A malformed chunk is not worth failing the whole completion over.
    }
  }
  return { text, inputTokens, outputTokens };
}

interface CortexChoice {
  message?: { content?: string };
  delta?: { content?: string };
  text?: string;
}

function extractFromJson(json: unknown): ParsedCortex {
  const obj = json as {
    choices?: CortexChoice[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = obj.choices?.[0];
  const text = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? '';
  return {
    text,
    inputTokens: obj.usage?.prompt_tokens,
    outputTokens: obj.usage?.completion_tokens,
  };
}

/* ---------- mock ---------- */

/**
 * Mock mode must still produce the ⚡-vs-🔬 contrast on the two DEMO.md questions — that
 * contrast is on the never-cut list, so a constant here would break the demo with no keys.
 */
function mockComplexity(prompt: string): 1 | 2 | 3 {
  const question = /Question:\s*(.*)$/m.exec(prompt)?.[1] ?? prompt;
  const q = question.toLowerCase();
  if (/rank|compare|trade-?off|opportunity cost|given (my|everything)|top \d/.test(q)) return 3;
  const words = q.trim().split(/\s+/).length;
  if (words > 24) return 3;
  if (words > 12) return 2;
  return 1;
}

const MOCK_FACTS = [
  'Free Ventures is a student-run startup accelerator at Berkeley; you apply with your own startup.',
  'Free Ventures applications close September 11, with an info session on September 3.',
  'Tarun is an incoming Berkeley freshman in applied math, CS-focused, already building a startup with a cofounder.',
  'Tarun wants at most two clubs, builder-first and startup-adjacent over resume-padding.',
  'Tarun has a hard cap of 8-10 hours per week across all clubs.',
  'Berkeley Consulting was ruled out because of its case-interview recruiting process.',
];

function mockComplete(
  tier: Tier,
  model: string,
  messages: LlmMessage[],
  inputTokens: number,
): CompleteResult {
  // The JSON instruction lives in the system message, so match against the whole exchange.
  const prompt = messages.map((m) => m.content).join('\n');
  const text = mockText(tier, prompt);
  const outputTokens = estimateTokens(text);
  return {
    text,
    model,
    tier,
    inputTokens,
    outputTokens,
    estCostUsd: estimateCostUsd(tier, inputTokens, outputTokens),
    mock: true,
  };
}

function mockText(tier: Tier, prompt: string): string {
  // Internal calls ask for JSON; returning prose would break every caller's parse.
  if (/"complexity"/i.test(prompt) || /^Context size:/m.test(prompt)) {
    const complexity = mockComplexity(prompt);
    return `{"complexity": ${complexity}, "reason": "heuristic mock classifier"}`;
  }
  if (/"facts"/i.test(prompt) || /compile minimal context/i.test(prompt)) {
    return JSON.stringify({
      facts: MOCK_FACTS,
      excludedNote:
        'Excluded: the club-by-club comparison, workload math, decision tree, and interview prep from the parent thread.',
    });
  }
  if (tier === 'deep') {
    return 'Ranked, with the opportunity cost of each:\n\n1. **Free Ventures** — the only option whose hours go into your own company. Cost: ~3-4 hrs/week of overhead and a September application window that collides with technical-org recruiting.\n2. **ML@B** — strongest technical peer group and the highest ceiling. Cost: 12-14 hrs/week once the first-semester education track is counted, with a three-week spike landing on November midterms.\n3. **Blueprint** — fits the 8-10 hr cap and has the strongest community. Cost: almost no technical stretch.\n\nCodebase is dominated in both branches; cut it and reclaim the application slot.';
  }
  if (tier === 'thoughtful') {
    return 'It depends on whether the 8-10 hr/week cap is real. If it is, Blueprint at 6-8 hrs is the only second club that fits. If you would revise it to 13-14 for the right club, ML@B has the higher ceiling.';
  }
  return 'Free Ventures applications close **September 11**, with an info session on September 3.';
}
