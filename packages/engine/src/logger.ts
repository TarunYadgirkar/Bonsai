/**
 * Injectable log seam. A library shouldn't write to the host console uninvited, but the default
 * stays `console` so current behavior is unchanged — consumers opt into silence or their own sink.
 *
 *   import { setEngineLogger, silenceEngine } from '@bonsai/engine';
 *   silenceEngine();                       // drop the fallback warnings
 *   setEngineLogger({ warn, error });      // or route them into your own logger
 *
 * Engine internals import `{ logger }` and call `logger.warn(...)` / `logger.error(...)`; the
 * wrapper delegates to whatever is active, so a swap takes effect everywhere at once.
 */
export interface EngineLogger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

let active: EngineLogger = console;

const NOOP: EngineLogger = { warn: () => {}, error: () => {} };

export const logger: EngineLogger = {
  warn: (...args: unknown[]) => active.warn(...args),
  error: (...args: unknown[]) => active.error(...args),
};

export function setEngineLogger(next: EngineLogger): void {
  active = next;
}

export function silenceEngine(): void {
  active = NOOP;
}
