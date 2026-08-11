/**
 * Neon HTTP client. One client per call — the serverless driver holds no pooled state worth
 * caching, and a fresh client per query sidesteps stale-connection edge cases on warm lambdas.
 */
import { neon } from '@neondatabase/serverless';

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  return neon(process.env.DATABASE_URL!);
}
