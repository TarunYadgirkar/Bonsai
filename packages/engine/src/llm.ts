/**
 * Inference. One model parameter, many models — the substrate the router needs.
 *
 * Two layers, first one available wins:
 *   1. A live provider (lib/provider.ts) when ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY is set.
 *   2. The mock, with realistic token math, so the app is walkable with zero keys.
 */
import { MODEL_TIERS, TIER_DEFAULTS, costForModel, costForServedBy, effortSpec } from './models';
import { providerComplete, providerCompleteStream } from './provider';
import { estimateTokens } from './tokens';
import type { Effort, InferencePurpose, QuestionKind, Tier } from './types';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteParams {
  tier: Tier;
  messages: LlmMessage[];
  /**
   * What this call is for. The mock dispatches on it (typed intent instead of prompt-sniffing);
   * live providers may use it for per-purpose defaults. Callers should always set it.
   */
  purpose?: InferencePurpose;
  /** ModelSpec.id. Defaults to the tier's model, so callers that only know a tier still work. */
  model?: string;
  /** Reasoning effort. Priced and capped as an output-token ceiling. */
  effort?: Effort;
  /** Explicit ceiling, overriding the one the effort level implies. */
  maxTokens?: number;
  temperature?: number;
  /** Caller cancellation (e.g. the HTTP client disconnected) — stops paying for unread tokens. */
  signal?: AbortSignal;
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

/**
 * The engine's inference seam. The default implementation below chains live provider → mock;
 * surfaces (CLI, tests) can inject their own — the compiler and router take one as a dependency.
 */
export type CompleteFn = (params: CompleteParams) => Promise<CompleteResult>;

/** Streaming sibling of CompleteFn: chunks hit onDelta as they arrive, result totals match. */
export type CompleteStreamFn = (
  params: CompleteParams,
  onDelta: (chunk: string) => void,
) => Promise<CompleteResult>;

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
    effort,
    temperature: params.temperature,
    signal: params.signal,
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
      estCostUsd: costForServedBy(live.servedBy, model, usedInput, usedOutput),
      mock: false,
      servedBy: live.servedBy,
    };
  }

  return mockComplete(tier, model, messages, inputTokens, params.purpose);
}

/** How the mock paces its fake stream: small word-groups, a beat apart, bounded total delay. */
const MOCK_CHUNK_WORDS = 4;
const MOCK_CHUNK_DELAY_MS = 14;
const MOCK_CHUNK_MAX = 60;

export async function completeStream(
  params: CompleteParams,
  onDelta: (chunk: string) => void,
): Promise<CompleteResult> {
  const { tier, messages } = params;
  const model = params.model ?? MODEL_TIERS[tier];
  const effort = params.effort ?? TIER_DEFAULTS[tier].effort;
  const maxTokens = params.maxTokens ?? effortSpec(effort).maxTokens;
  const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);

  const live = await providerCompleteStream(
    { model, messages, maxTokens, effort, temperature: params.temperature, signal: params.signal },
    onDelta,
  );
  if (live) {
    const usedInput = live.inputTokens || inputTokens;
    const usedOutput = live.outputTokens || estimateTokens(live.text);
    return {
      text: live.text,
      model,
      tier,
      inputTokens: usedInput,
      outputTokens: usedOutput,
      estCostUsd: costForServedBy(live.servedBy, model, usedInput, usedOutput),
      mock: false,
      servedBy: live.servedBy,
    };
  }

  // Mock: answer instantly, then replay it as a paced stream so the zero-key demo shows the
  // same UI the live path does. The pacing is capped so long answers don't crawl.
  const result = mockComplete(tier, model, messages, inputTokens, params.purpose);
  const words = result.text.split(/(?<=\s)/);
  const perChunk = Math.max(MOCK_CHUNK_WORDS, Math.ceil(words.length / MOCK_CHUNK_MAX));
  for (let i = 0; i < words.length; i += perChunk) {
    onDelta(words.slice(i, i + perChunk).join(''));
    if (i + perChunk < words.length) {
      await new Promise((resolve) => setTimeout(resolve, MOCK_CHUNK_DELAY_MS));
    }
  }
  return result;
}

/* ---------- mock ---------- */

/**
 * Deliberately heuristic, never a constant: the cheap-vs-deep routing contrast is the product,
 * and zero-key mode must still demonstrate it.
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

/** Ordered by precedence: the first matching cue names the kind when several fire. */
const KIND_CUES: { kind: QuestionKind; cue: RegExp }[] = [
  { kind: 'comparison', cue: /\b(rank(s|ed|ing)?|compar(e|es|ed|ison)|vs|versus|which of|trade-?offs?)\b/ },
  { kind: 'code', cue: /\b(rewrite|refactor|debug|code|function|bug|implement)\b/ },
  { kind: 'creative', cue: /\b(write|draft|story|poem|creative)\b/ },
  { kind: 'synthesis', cue: /\b(why|explain|summar\w*)\b/ },
  { kind: 'lookup', cue: /\b(when|what|where|who|how many|deadline|list)\b/ },
];

const CLEAR_CUE_CONFIDENCE = 0.85;
const STRUCTURAL_CUE_CONFIDENCE = 0.6;
const UNCLEAR_CONFIDENCE = 0.4;
/** A lookup is a SHORT factual ask; the same cue words in a long question are not a lookup. */
const LOOKUP_MAX_WORDS = 12;
const REASONING_MIN_WORDS = 16;
const REASONING_MIN_CLAUSES = 3;

/**
 * Kind + confidence from surface cues. One clear cue is a confident read; several competing
 * cues or none at all is an honest "not sure", which the learning layer treats more cautiously.
 */
function mockKind(question: string): { kind: QuestionKind; confidence: number } {
  const q = question.toLowerCase();
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  const matched = KIND_CUES.filter(
    ({ kind, cue }) => cue.test(q) && (kind !== 'lookup' || words <= LOOKUP_MAX_WORDS),
  );
  if (matched.length === 1) return { kind: matched[0].kind, confidence: CLEAR_CUE_CONFIDENCE };
  if (matched.length > 1) return { kind: matched[0].kind, confidence: UNCLEAR_CONFIDENCE };
  // No lexical cue: a long multi-clause question is weighing something — reasoning.
  const clauses = q.split(/,|;|\band\b/).filter((part) => part.trim().length > 0).length;
  if (words >= REASONING_MIN_WORDS && clauses >= REASONING_MIN_CLAUSES) {
    return { kind: 'reasoning', confidence: STRUCTURAL_CUE_CONFIDENCE };
  }
  return { kind: 'other', confidence: UNCLEAR_CONFIDENCE };
}

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

/* ---------- salience (the mock compiler's ranking) ---------- */

type SpeakerRole = 'user' | 'assistant' | 'system' | 'unknown';

interface RoleSentence {
  text: string;
  role: SpeakerRole;
}

/** Small enough that shared-vocabulary evidence still dominates; enough to break ties late. */
const RECENCY_WEIGHT = 0.5;
/** Assistant statements of fact and user constraints beat questions and filler. */
const ROLE_FACT_WEIGHT = 0.75;

const CONSTRAINT_CUE =
  /\b(must|need|want|only|at most|at least|no more than|cap|capped|cannot|can't|won't|budget|prefer|require|hard)\b/i;

/** sentencesOf, but keeping who said each sentence. Role is sticky across a turn's lines. */
function sentencesWithRole(transcript: string): RoleSentence[] {
  let role: SpeakerRole = 'unknown';
  const out: RoleSentence[] = [];
  for (const line of transcript.split('\n')) {
    const tag = /^(user|assistant|system):\s*/i.exec(line);
    if (tag) role = tag[1].toLowerCase() as SpeakerRole;
    const body = line.replace(/^(user|assistant|system):\s*/i, '');
    for (const raw of body.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text.length > 30 && text.length < 320) out.push({ text, role });
    }
  }
  return out;
}

/**
 * Inverse-sentence-frequency: a query term found in one transcript sentence identifies that
 * sentence; a term found in every sentence identifies nothing. 1 + ln(N/sf) floors at 1, so a
 * match never counts for less than the old flat tally did.
 */
function rarityWeights(sentences: string[], terms: string[]): Map<string, number> {
  const lower = sentences.map((s) => s.toLowerCase());
  const total = Math.max(1, lower.length);
  const weights = new Map<string, number>();
  for (const term of terms) {
    const inSentences = lower.filter((s) => s.includes(term)).length;
    weights.set(term, 1 + Math.log(total / Math.max(1, inSentences)));
  }
  return weights;
}

function roleWeight(sentence: RoleSentence): number {
  if (sentence.text.endsWith('?')) return 0; // a question is never a fact for the brief
  if (sentence.role === 'assistant') return ROLE_FACT_WEIGHT;
  if (sentence.role === 'user' && CONSTRAINT_CUE.test(sentence.text)) return ROLE_FACT_WEIGHT;
  return 0;
}

/**
 * Salience = Σ rarity of matched terms + topic mention + recency + role. Only sentences that
 * share vocabulary with the question (or name the topic outright) are candidates at all —
 * recency and role order the relevant, they never rescue the irrelevant.
 */
function rankBySalience(
  sentences: RoleSentence[],
  terms: string[],
  limit: number,
  topic?: string,
): string[] {
  const needle = topic?.trim().toLowerCase();
  const rarity = rarityWeights(sentences.map((s) => s.text), terms);
  const span = Math.max(1, sentences.length - 1);
  return sentences
    .map((sentence, i) => {
      const hay = sentence.text.toLowerCase();
      const termScore = terms.reduce(
        (sum, t) => (hay.includes(t) ? sum + (rarity.get(t) ?? 0) : sum),
        0,
      );
      const topicScore = needle && hay.includes(needle) ? TOPIC_MENTION_WEIGHT : 0;
      const relevant = termScore + topicScore;
      const score = relevant + RECENCY_WEIGHT * (i / span) + roleWeight(sentence);
      return { text: sentence.text, relevant, score, i };
    })
    .filter((c) => c.relevant > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((c) => c.text);
}

/**
 * Extractive stand-in for the compiler. Ranks the parent transcript's sentences by salience —
 * rare identifying terms over common shared words, topic mentions, late-transcript recency,
 * and factual roles — so branching on anything other than the two scripted demo selections
 * still produces a brief about the thing that was highlighted.
 */
function mockCompilerJson(prompt: string): string {
  const selection = /Branch topic \(highlighted text\):\s*(.*)$/m.exec(prompt)?.[1] ?? '';
  const question = /Branch question:\s*(.*)$/m.exec(prompt)?.[1] ?? '';
  const transcript = prompt.split(/^Parent conversation:$/m)[1] ?? '';

  const sentences = sentencesWithRole(transcript);
  const terms = keywords(`${selection} ${question}`);
  let facts = rankBySalience(sentences, terms, MOCK_FACT_COUNT, selection);

  // When no sentence shares vocabulary with the question (e.g. "the deadline" vs "applications
  // close"), carry the INHERITED BRIEF forward: the assembled path leads with it, so the earliest
  // substantive statements preserve referents an ancestor already resolved. This is what keeps a
  // depth-2 fork's grandparent entity alive — genuinely, not by injecting a hardcoded fixture.
  if (!facts.length) {
    facts = sentences
      .filter((s) => !s.text.endsWith('?'))
      .slice(0, MOCK_FACT_COUNT)
      .map((s) => s.text);
  }

  return JSON.stringify({
    facts: facts.length ? facts : [`Topic in focus: ${selection || question || 'this branch'}.`],
    excludedNote: `Excluded: the rest of the parent thread — everything not bearing on ${selection || 'this branch'}.`,
  });
}

function mockComplete(
  tier: Tier,
  model: string,
  messages: LlmMessage[],
  inputTokens: number,
  purpose?: InferencePurpose,
): CompleteResult {
  // The JSON instruction lives in the system message, so match against the whole exchange.
  const prompt = messages.map((m) => m.content).join('\n');
  const text = mockText(tier, prompt, purpose);
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

/** Two fixture questions keep rehearsed answers for demo polish; everything else is extractive. */
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

  const facts = factsFromBrief(prompt);
  const onBrief = facts.length > 0;
  const body = prompt.split(/\n---\n/).slice(0, -1).join('\n---\n');
  // Roots have no brief — their transcript IS the context, so extract from it directly. A
  // branch stays brief-only (the punt is what drives widening), but once the ladder has pulled
  // parent turns in, those turns are answer material too.
  const widened = /## Pulled from the parent thread[^\n]*\n([\s\S]*)$/.exec(body)?.[1] ?? '';
  const candidates = onBrief
    ? [...facts, ...sentencesOf(widened).filter((s) => !s.endsWith('?'))]
    : sentencesOf(body).filter((s) => !s.endsWith('?'));

  // Two matching terms, not one: a lone "Berkeley" hit is not an answer, it is a coincidence.
  const hits = rankByRelevance(
    candidates,
    keywords(question),
    FACTS_PER_TIER[tier],
    undefined,
    ANSWER_MIN_SCORE,
  );
  if (!hits.length) {
    return onBrief
      ? 'The compiled brief for this branch does not cover that. Ask to pull more of the parent thread in, or branch again from the part of the conversation that does.'
      : 'The context here does not cover that yet — add what matters to the conversation and ask again.';
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

/** Facts as the router's classifier prompt renders them — a `Brief facts:` block of bullets. */
function classifierFacts(prompt: string): string[] {
  const section = /Brief facts:\n([\s\S]*?)(?:\nQuestion:|$)/.exec(prompt)?.[1] ?? '';
  return section
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
}

function mockClassifierJson(prompt: string): string {
  const complexity = mockComplexity(prompt);
  const question = /Question:\s*(.*)$/m.exec(prompt)?.[1] ?? '';
  const { kind, confidence } = mockKind(question);
  const facts = classifierFacts(prompt);
  // No facts in the prompt means there is no brief to judge — a root or a briefless call.
  const covered =
    !facts.length ||
    rankByRelevance(facts, keywords(question), 1, undefined, ANSWER_MIN_SCORE).length > 0;
  return JSON.stringify({
    complexity,
    kind,
    covered,
    confidence,
    reason: 'heuristic mock classifier',
  });
}

function mockText(tier: Tier, prompt: string, purpose?: InferencePurpose): string {
  // Typed intent first; prompt-sniffing only for callers that predate the purpose field.
  switch (purpose) {
    case 'classify':
      return mockClassifierJson(prompt);
    case 'compile':
      return mockCompilerJson(prompt);
    case 'merge':
      return mockDistill(prompt);
    case 'chat':
      return mockAnswer(tier, prompt);
    default:
      break;
  }
  if (/"complexity"/i.test(prompt) || /^Context size:/m.test(prompt)) {
    return mockClassifierJson(prompt);
  }
  if (/"facts"/i.test(prompt) || /compile minimal context/i.test(prompt)) {
    return mockCompilerJson(prompt);
  }
  if (/single durable conclusion/i.test(prompt)) return mockDistill(prompt);
  return mockAnswer(tier, prompt);
}
