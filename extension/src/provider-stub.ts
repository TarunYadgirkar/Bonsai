/**
 * Build-time replacement for bonsai-engine's provider.ts in the extension bundle. It makes the
 * human-in-the-loop guarantee STRUCTURAL: the real provider's fetch-to-model POST code (to
 * api.anthropic.com / OpenAI-compatible endpoints) is never bundled at all. Everything resolves to
 * the extractive mock — providerName 'mock', providerComplete null — so no send path can exist.
 *
 * Wired in extension/build.mjs via an esbuild onResolve plugin that redirects the engine's
 * './provider' import here. Keep the export surface in sync with packages/engine/src/provider.ts.
 */
export type ProviderName = 'anthropic' | 'openai' | 'xai' | 'mock';

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  servedBy?: string;
}

export interface ProviderParams {
  model: string;
  messages: ProviderMessage[];
  maxTokens: number;
  effort?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export function providerName(): ProviderName {
  return 'mock';
}

export function isLiveProvider(): boolean {
  return false;
}

export async function providerComplete(_params: ProviderParams): Promise<ProviderResult | null> {
  return null;
}

export function anthropicBody(): Record<string, unknown> {
  return {};
}

export function providerSummary(): { provider: ProviderName; models: Record<string, string> } {
  return { provider: 'mock', models: {} };
}

export async function providerCompleteStream(
  _params: ProviderParams,
  _onDelta: (chunk: string) => void,
): Promise<ProviderResult | null> {
  return null;
}
