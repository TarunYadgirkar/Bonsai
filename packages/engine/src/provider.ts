/**
 * Live inference backend. Pick one by setting exactly one key; with none set the app stays on the
 * mock and nothing else changes (AGENTS.md mock-first rule).
 *
 *   ANTHROPIC_API_KEY   → api.anthropic.com/v1/messages       — the honest one: every model name
 *                          on screen (Haiku 4.5 / Sonnet 5 / Opus 5 / Fable 5) is the model that
 *                          actually answered.
 *   OPENAI_API_KEY      → api.openai.com/v1/chat/completions
 *   XAI_API_KEY         → api.x.ai/v1/chat/completions
 *
 * Request shape is driven by a per-model capability record — the 4.6+/5 Claude models reject
 * sampling params (400) and take reasoning effort via output_config.effort, while Haiku 4.5 is
 * the reverse. Never hand-build a request body outside `anthropicBody`.
 *
 * Every failure returns null and the caller falls back to the mock. A dead key, a wrong model
 * name, a rate limit and a timeout all degrade to a working demo (rule 8).
 */
import { logger } from './logger';
import { MODELS } from './models';
import type { Effort } from './types';

export type ProviderName = 'anthropic' | 'openai' | 'xai' | 'mock';

export function providerName(): ProviderName {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.XAI_API_KEY) return 'xai';
  return 'mock';
}

export function isLiveProvider(): boolean {
  return providerName() !== 'mock';
}

/**
 * Bonsai model id → the upstream id to actually call, per provider.
 *
 * Every entry is overridable by env (BONSAI_MODEL_<PROVIDER>_<QUICK|MID|DEEP|CEILING>) because
 * model names change faster than a hackathon: a wrong id 404s, logs one line and falls back to
 * the mock rather than breaking the demo, and the fix is an env var rather than a deploy.
 */
function upstreamModel(bonsaiModelId: string): string {
  const rung = RUNG_BY_MODEL[bonsaiModelId] ?? 'QUICK';
  const provider = providerName();
  const override = process.env[`BONSAI_MODEL_${provider.toUpperCase()}_${rung}`];
  if (override) return override;
  return DEFAULT_UPSTREAM[provider]?.[rung] ?? bonsaiModelId;
}

type Rung = 'QUICK' | 'MID' | 'DEEP' | 'CEILING';

const RUNG_BY_MODEL: Record<string, Rung> = {
  'claude-haiku-4-5': 'QUICK',
  'claude-sonnet-5': 'MID',
  'claude-opus-5': 'DEEP',
  'claude-fable-5': 'CEILING',
};

/** Verified against provider model pages 2026-08-10. Re-verify before shipping — ids rot. */
const DEFAULT_UPSTREAM: Record<string, Record<Rung, string>> = {
  anthropic: {
    QUICK: 'claude-haiku-4-5-20251001',
    MID: 'claude-sonnet-5',
    DEEP: 'claude-opus-5',
    CEILING: 'claude-fable-5',
  },
  openai: {
    QUICK: 'gpt-5.4-mini',
    MID: 'gpt-5.4',
    DEEP: 'gpt-5.5',
    CEILING: 'gpt-5.5',
  },
  xai: {
    QUICK: 'grok-4.3',
    MID: 'grok-4.3',
    DEEP: 'grok-4.5',
    CEILING: 'grok-4.5',
  },
};

/**
 * What each Anthropic upstream accepts. The 4.6+/5 rules (verified 2026-08-10):
 * sampling params 400 on Sonnet 5/Opus 5/Fable 5; output_config.effort exists there and NOT on
 * Haiku 4.5; thinking is adaptive-by-default (always-on for Fable) and max_tokens caps
 * thinking + text COMBINED, so effortful calls need far more headroom than the visible answer.
 */
interface AnthropicCaps {
  sampling: boolean;
  effort: boolean;
}

function anthropicCaps(upstream: string): AnthropicCaps {
  if (upstream.startsWith('claude-haiku-4-5')) return { sampling: true, effort: false };
  return { sampling: false, effort: true };
}

/** max_tokens must cover thinking + answer on adaptive models. Keyed by effort. */
const TOTAL_CAP_BY_EFFORT: Record<Effort, number> = {
  low: 4000,
  medium: 6000,
  high: 12000,
  max: 16000,
};

const TIMEOUT_BY_EFFORT: Record<Effort, number> = {
  low: 30_000,
  medium: 45_000,
  high: 90_000,
  max: 120_000,
};

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The upstream model that actually answered, for the UI's "served by" line. */
  servedBy: string;
}

export interface ProviderParams {
  model: string;
  messages: ProviderMessage[];
  maxTokens: number;
  effort?: Effort;
  temperature?: number;
  signal?: AbortSignal;
}

export async function providerComplete(params: ProviderParams): Promise<ProviderResult | null> {
  const provider = providerName();
  if (provider === 'mock') return null;

  const upstream = upstreamModel(params.model);
  try {
    const result =
      provider === 'anthropic'
        ? await callAnthropic(upstream, params)
        : await callOpenAiCompatible(provider, upstream, params);
    if (!result?.text.trim()) {
      logger.warn(`[llm] ${provider} returned no content on ${upstream} — falling back to mock`);
      return null;
    }
    return result;
  } catch (err) {
    // A caller-initiated abort is a cancellation, not a provider failure — propagate it instead of
    // answering with a mock. Our own timeout abort (params.signal not aborted) still degrades.
    if ((err as Error).name === 'AbortError' && params.signal?.aborted) throw err;
    logger.warn(`[llm] ${provider} failed (${(err as Error).message}) — falling back to mock`);
    return null;
  }
}

/* ---------- anthropic ---------- */

/** Exported for tests: the request body IS the param-policy contract. */
export function anthropicBody(
  upstream: string,
  params: Pick<ProviderParams, 'messages' | 'maxTokens' | 'effort' | 'temperature'>,
): Record<string, unknown> {
  const caps = anthropicCaps(upstream);
  // The Messages API takes the system prompt as a top-level field, not as a message.
  const system = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = params.messages.filter((m) => m.role !== 'system');
  const effort = params.effort ?? 'medium';

  return {
    model: upstream,
    // On adaptive-thinking models the cap covers thinking + text; the caller's answer-sized
    // ceiling would truncate mid-thought, so the effort-keyed total wins when larger.
    max_tokens: caps.effort
      ? Math.max(params.maxTokens, TOTAL_CAP_BY_EFFORT[effort])
      : params.maxTokens,
    ...(caps.sampling ? { temperature: params.temperature ?? 0.2 } : {}),
    ...(caps.effort ? { output_config: { effort } } : {}),
    ...(system ? { system } : {}),
    messages: turns.map((m) => ({ role: m.role, content: m.content })),
  };
}

async function callAnthropic(upstream: string, params: ProviderParams): Promise<ProviderResult> {
  const timeout = AbortSignal.timeout(TIMEOUT_BY_EFFORT[params.effort ?? 'medium']);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(anthropicBody(upstream, params)),
    signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
  });

  if (!res.ok) throw new Error(`anthropic ${res.status} ${(await res.text()).slice(0, 160)}`);

  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  // Fable 5's safety classifiers can end a response with stop_reason "refusal" — degrade rather
  // than surface a half-answer as if it were complete.
  if (body.stop_reason === 'refusal') throw new Error(`anthropic refusal on ${upstream}`);
  return {
    text: (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(''),
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    servedBy: upstream,
  };
}

/* ---------- openai / xai ---------- */

async function callOpenAiCompatible(
  provider: 'openai' | 'xai',
  upstream: string,
  params: ProviderParams,
): Promise<ProviderResult> {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.XAI_API_KEY;
  const timeout = AbortSignal.timeout(TIMEOUT_BY_EFFORT[params.effort ?? 'medium']);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: upstream,
      messages: params.messages,
      max_completion_tokens: params.maxTokens,
    }),
    signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
  });

  if (!res.ok) throw new Error(`${provider} ${res.status} ${(await res.text()).slice(0, 160)}`);

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    servedBy: upstream,
  };
}

/** Sanity check for scripts/try-provider.ts — names the provider and the four upstream ids. */
export function providerSummary(): { provider: ProviderName; models: Record<string, string> } {
  return {
    provider: providerName(),
    models: Object.fromEntries(MODELS.map((m) => [m.label, upstreamModel(m.id)])),
  };
}

/* ---------- streaming ---------- */

/**
 * Streaming sibling of providerComplete. Text chunks reach `onDelta` as they arrive; the
 * resolved result carries the same totals the non-streaming path would have returned.
 *
 * Anthropic streams natively (SSE). OpenAI/xAI fall back to the buffered call and emit the
 * whole answer as one delta — honest, just not incremental. Mock returns null here too; the
 * llm layer chunks the mock itself so zero-key demos still show the stream.
 */
export async function providerCompleteStream(
  params: ProviderParams,
  onDelta: (chunk: string) => void,
): Promise<ProviderResult | null> {
  const provider = providerName();
  if (provider === 'mock') return null;

  const upstream = upstreamModel(params.model);
  try {
    if (provider === 'anthropic') {
      const result = await callAnthropicStream(upstream, params, onDelta);
      if (!result.text.trim()) {
        logger.warn(`[llm] anthropic stream returned no content on ${upstream} — mock fallback`);
        return null;
      }
      return result;
    }
    const result = await callOpenAiCompatible(provider, upstream, params);
    if (!result.text.trim()) return null;
    onDelta(result.text);
    return result;
  } catch (err) {
    if ((err as Error).name === 'AbortError' && params.signal?.aborted) throw err;
    logger.warn(`[llm] ${provider} stream failed (${(err as Error).message}) — mock fallback`);
    return null;
  }
}

/** One SSE frame's parsed event name + JSON data line. */
function* sseFrames(buffer: string): Generator<{ event: string; data: string }> {
  for (const frame of buffer.split('\n\n')) {
    let event = '';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event && data) yield { event, data };
  }
}

async function callAnthropicStream(
  upstream: string,
  params: ProviderParams,
  onDelta: (chunk: string) => void,
): Promise<ProviderResult> {
  const timeout = AbortSignal.timeout(TIMEOUT_BY_EFFORT[params.effort ?? 'medium']);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...anthropicBody(upstream, params), stream: true }),
    signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
  });

  if (!res.ok || !res.body) {
    throw new Error(`anthropic ${res.status} ${(await res.text()).slice(0, 160)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | undefined;

  const consume = (chunk: string) => {
    buffer += chunk;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const { event, data } of sseFrames(frames.join('\n\n'))) {
      if (event === 'error') throw new Error(`anthropic stream error ${data.slice(0, 160)}`);
      const parsed = JSON.parse(data) as {
        type?: string;
        message?: { usage?: { input_tokens?: number } };
        delta?: { type?: string; text?: string; stop_reason?: string };
        usage?: { output_tokens?: number };
      };
      if (parsed.type === 'message_start') {
        inputTokens = parsed.message?.usage?.input_tokens ?? 0;
      } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        const piece = parsed.delta.text ?? '';
        if (piece) {
          text += piece;
          onDelta(piece);
        }
      } else if (parsed.type === 'message_delta') {
        outputTokens = parsed.usage?.output_tokens ?? outputTokens;
        stopReason = parsed.delta?.stop_reason ?? stopReason;
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());

  // Same refusal rule as the buffered path — degrade rather than surface a half-answer.
  if (stopReason === 'refusal') throw new Error(`anthropic refusal on ${upstream}`);
  return { text, inputTokens, outputTokens, servedBy: upstream };
}
