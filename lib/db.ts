/**
 * Neon HTTP client. One client per call — the serverless driver holds no pooled state worth
 * caching, and a fresh client per query sidesteps stale-connection edge cases on warm lambdas.
 */
import { neon, neonConfig } from '@neondatabase/serverless';

/**
 * The driver sets no timeout of its own, so a stalled Neon request used to hold a connector call
 * until Vercel killed it at 60s. Each HTTP query now fails after this long, and every caller
 * already degrades or reports on a thrown query.
 */
export const QUERY_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(ms: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}

neonConfig.fetchFunction = fetchWithTimeout(QUERY_TIMEOUT_MS);

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  return neon(process.env.DATABASE_URL!);
}
