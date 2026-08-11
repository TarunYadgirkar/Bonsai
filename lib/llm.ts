/**
 * Inference. One model parameter, many models — the substrate the router needs.
 *
 * Two layers, first one available wins:
 *   1. A live provider (lib/provider.ts) when ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY is set.
 *   2. The mock, with realistic token math, so the app is walkable with zero keys.
 */
import { MODEL_TIERS, TIER_DEFAULTS, costForModel, effortSpec } from './models';
import { providerComplete } from './provider';
import { estimateTokens } from './tokens';
import type { Effort, Tier } from './types';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteParams {
  tier: Tier;
  messages: LlmMessage[];
  /** ModelSpec.id. Defaults to the tier's model, so callers that only know a tier still work. */
  model?: string;
  /** Reasoning effort. Priced and capped as an output-token ceiling. */
  effort?: Effort;
  /** Explicit ceiling, overriding the one the effort level implies. */
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
  /** True when the response came from the mock rather than a live model. */
  mock: boolean;
  /** Upstream model that actually answered. Absent on the mock. */
  servedBy?: string;
}

export async function complete(params: CompleteParams): Promise<CompleteResult> {
  const { tier, messages } = params;
  const model = params.model ?? MODEL_TIERS[tier];
  const effort = params.effort ?? TIER_DEFAULTS[tier].effort;
  const maxTokens = params.maxTokens ?? effortSpec(effort).maxTokens;
  const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);

  // A live key wins over everything: real completion, real token counts off the API's own usage.
  const live = await providerComplete({
    model,
    messages,
    maxTokens,
    temperature: params.temperature,
  });
  if (live) {
    const usedInput = live.inputTokens || inputTokens;
    const usedOutput = live.outputTokens || estimateTokens(live.text);
    return {
      text: live.text,
      model,
      tier,
      inputTokens: usedInput,
      outputTokens: usedOutput,
      estCostUsd: costForModel(model, usedInput, usedOutput),
      mock: false,
      servedBy: live.servedBy,
    };
  }

  return mockComplete(tier, model, messages, inputTokens);
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

const MOCK_FACT_COUNT = 6;

const STOPWORDS = new Set(
  ('the a an and or but if of to in on for with about from into over after is are was were be been' +
    ' do does did what when where which who whom how why my your our their this that these those i' +
    ' you he she it we they me him her us them can could should would will shall may might must not' +
    ' have has had all any some more most other than then them there here also just only very much')
    .split(' '),
);

/**
 * Content words only — the shared basis for every mock relevance score. `@` and `&` stay in the
 * token because the club names in this fixture are ML@B and similar; splitting them drops the
 * single most identifying word in the question.
 */
function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9'@&+-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

function relevance(candidate: string, terms: string[]): number {
  const hay = candidate.toLowerCase();
  return terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
}

function sentencesOf(transcript: string): string[] {
  return transcript
    .split('\n')
    .map((line) => line.replace(/^(user|assistant|system):\s*/i, '').trim())
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 30 && s.length < 320);
}

/** A sentence naming the branch topic outright beats one that merely shares vocabulary with it. */
const TOPIC_MENTION_WEIGHT = 3;

function rankByRelevance(
  candidates: string[],
  terms: string[],
  limit: number,
  topic?: string,
  minScore = 1,
): string[] {
  const needle = topic?.trim().toLowerCase();
  return candidates
    .map((text, i) => {
      const mentions = needle && text.toLowerCase().includes(needle) ? TOPIC_MENTION_WEIGHT : 0;
      return { text, score: relevance(text, terms) + mentions, i };
    })
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((c) => c.text);
}

/**
 * Extractive stand-in for the compiler. Pulls the sentences that actually mention the branch
 * topic out of the real parent transcript, so branching on anything other than the two scripted
 * demo selections still produces a brief about the thing that was highlighted. The constant
 * fact list is only the last resort.
 */
function mockCompilerJson(prompt: string): string {
  const selection = /Branch topic \(highlighted text\):\s*(.*)$/m.exec(prompt)?.[1] ?? '';
  const question = /Branch question:\s*(.*)$/m.exec(prompt)?.[1] ?? '';
  const transcript = prompt.split(/^Parent conversation:$/m)[1] ?? '';

  const terms = keywords(`${selection} ${question}`);
  const facts = rankByRelevance(sentencesOf(transcript), terms, MOCK_FACT_COUNT, selection);

  return JSON.stringify({
    facts: facts.length ? facts : MOCK_FACTS,
    excludedNote: facts.length
      ? `Excluded: the rest of the parent thread — everything not bearing on ${selection || 'this branch'}.`
      : 'Excluded: the club-by-club comparison, workload math, decision tree, and interview prep from the parent thread.',
  });
}

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
    estCostUsd: costForModel(model, inputTokens, outputTokens),
    mock: true,
  };
}

/** The two DEMO.md questions keep their rehearsed answers; everything else is grounded below. */
const DEADLINE_QUESTION = /\b(when|what date|deadline|due)\b.*\b(close|closes|due|deadline|apply|application)\b/i;
const RANKING_QUESTION = /\b(rank|top \d|opportunity cost|compare)\b/i;

const DEMO_ANSWERS = {
  deadline:
    'Free Ventures applications close **September 11**, with an info session on September 3. That is eight days between the session and the deadline — draft the application before September 3 rather than after.',
  ranking:
    'Ranked, with the opportunity cost of each:\n\n1. **Free Ventures** — the only option whose hours go into your own company. Cost: ~3-4 hrs/week of overhead and a September application window that collides with technical-org recruiting.\n2. **ML@B** — strongest technical peer group and the highest ceiling. Cost: 12-14 hrs/week once the first-semester education track is counted, with a three-week spike landing on November midterms.\n3. **Blueprint** — fits the 8-10 hr cap and has the strongest community. Cost: almost no technical stretch.\n\nCodebase is dominated in both branches; cut it and reclaim the application slot.',
} as const;

const FACTS_PER_TIER: Record<Tier, number> = { quick: 1, thoughtful: 3, deep: 5 };
const ANSWER_MIN_SCORE = 2;

/** Pull the compiled facts back out of the brief the caller pasted into the prompt. */
function factsFromBrief(prompt: string): string[] {
  const section = /## Relevant facts\n([\s\S]*?)(?:\n##|\n---|$)/.exec(prompt)?.[1] ?? '';
  return section
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
}

/**
 * Answers off the brief instead of a canned table, so an unscripted question gets a response
 * about what was actually asked. Saying "the brief does not cover this" is the honest outcome
 * and matches what the real system prompt tells a live model to do — it is not a failure state.
 */
function mockAnswer(tier: Tier, prompt: string): string {
  const question = prompt.split(/\n---\n/).pop()?.trim() ?? '';
  if (DEADLINE_QUESTION.test(question)) return DEMO_ANSWERS.deadline;
  if (RANKING_QUESTION.test(question)) return DEMO_ANSWERS.ranking;

  // Two matching terms, not one: a lone "Berkeley" hit is not an answer, it is a coincidence.
  const hits = rankByRelevance(
    factsFromBrief(prompt),
    keywords(question),
    FACTS_PER_TIER[tier],
    undefined,
    ANSWER_MIN_SCORE,
  );
  if (!hits.length) {
    return 'The compiled brief for this branch does not cover that. Ask to pull more of the parent thread in, or branch again from the part of the conversation that does.';
  }
  if (tier === 'quick') return hits[0];
  return `${hits.map((h) => `- ${h}`).join('\n')}\n\nThat is what this branch's brief supports; anything beyond it would need more of the parent thread pulled in.`;
}

const INSIGHT_MAX_WORDS = 20;

/** /api/merge wants one durable line, not a paragraph — it keeps only the first line anyway. */
function mockDistill(prompt: string): string {
  const topic = /Branch topic:\s*(.*)$/m.exec(prompt)?.[1] ?? '';
  const body = prompt.split(/^Branch topic:.*$/m).pop() ?? prompt;
  // An insight is a conclusion, so the branch's own questions are not candidates for it.
  const statements = sentencesOf(body).filter((s) => !s.endsWith('?'));
  const best = rankByRelevance(statements, keywords(topic), 1, topic)[0];
  if (!best) return `No durable conclusion reached on ${topic || 'this branch'}.`;
  const words = best.replace(/\*\*/g, '').split(/\s+/);
  return words.length <= INSIGHT_MAX_WORDS
    ? best.replace(/\*\*/g, '')
    : `${words.slice(0, INSIGHT_MAX_WORDS).join(' ')}…`;
}

function mockText(tier: Tier, prompt: string): string {
  // Internal calls ask for JSON; returning prose would break every caller's parse.
  if (/"complexity"/i.test(prompt) || /^Context size:/m.test(prompt)) {
    const complexity = mockComplexity(prompt);
    return `{"complexity": ${complexity}, "reason": "heuristic mock classifier"}`;
  }
  if (/"facts"/i.test(prompt) || /compile minimal context/i.test(prompt)) {
    return mockCompilerJson(prompt);
  }
  if (/single durable conclusion/i.test(prompt)) return mockDistill(prompt);
  return mockAnswer(tier, prompt);
}
