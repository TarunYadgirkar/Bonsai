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
 * OpenAI and xAI speak the same request shape, so they share a path. When either serves a request,
 * `servedBy` carries the real upstream model so the UI can say so — the chips keep Bonsai's
 * vocabulary, but nothing claims a Claude model answered when one did not.
 *
 * Mock is selected only when no provider key is configured. A configured provider failure is
 * surfaced to the caller so live operation is never misrepresented as a mock success.
 */
import { MODELS } from './models';

const TIMEOUT_MS = 30_000;

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
 * model names change faster than a hackathon: the fix for a wrong id is an env var rather than a
 * deploy.
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

const DEFAULT_UPSTREAM: Record<string, Record<Rung, string>> = {
  anthropic: {
    QUICK: 'claude-haiku-4-5-20251001',
    MID: 'claude-sonnet-5',
    DEEP: 'claude-opus-5',
    CEILING: 'claude-fable-5',
  },
  openai: {
    QUICK: 'gpt-4o-mini',
    MID: 'gpt-4o',
    DEEP: 'gpt-4o',
    CEILING: 'gpt-4o',
  },
  xai: {
    QUICK: 'grok-2-latest',
    MID: 'grok-2-latest',
    DEEP: 'grok-2-latest',
    CEILING: 'grok-2-latest',
  },
};

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderResult {
  text: string;
  /** Exact provider usage when reported; absent means the caller must estimate. */
  inputTokens?: number;
  outputTokens?: number;
  /** The upstream model that actually answered, for the UI's "served by" line. */
  servedBy: string;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

export async function providerComplete(params: {
  model: string;
  messages: ProviderMessage[];
  maxTokens: number;
  temperature?: number;
}): Promise<ProviderResult | null> {
  const provider = providerName();
  if (provider === 'mock') return null;

  const upstream = upstreamModel(params.model);
  try {
    const result =
      provider === 'anthropic'
        ? await callAnthropic(upstream, params)
        : await callOpenAiCompatible(provider, upstream, params);
    return result;
  } catch (error: unknown) {
    if (error instanceof ProviderUnavailableError) throw error;
    const message = error instanceof Error ? error.message : 'unknown provider failure';
    throw new ProviderUnavailableError(message, { cause: error });
  }
}

/* ---------- anthropic ---------- */

async function callAnthropic(
  upstream: string,
  params: { messages: ProviderMessage[]; maxTokens: number; temperature?: number },
): Promise<ProviderResult> {
  // The Messages API takes the system prompt as a top-level field, not as a message.
  const system = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = params.messages.filter((m) => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: upstream,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.2,
      ...(system ? { system } : {}),
      messages: turns.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status} ${(await res.text()).slice(0, 160)}`);

  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(''),
    inputTokens: body.usage?.input_tokens,
    outputTokens: body.usage?.output_tokens,
    servedBy: upstream,
  };
}

/* ---------- openai / xai ---------- */

async function callOpenAiCompatible(
  provider: 'openai' | 'xai',
  upstream: string,
  params: { messages: ProviderMessage[]; maxTokens: number; temperature?: number },
): Promise<ProviderResult> {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.XAI_API_KEY;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: upstream,
      messages: params.messages,
      max_completion_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`${provider} ${res.status} ${(await res.text()).slice(0, 160)}`);

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
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
