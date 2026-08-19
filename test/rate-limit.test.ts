import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from '../lib/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fresh = () => `s_${Math.random().toString(36).slice(2)}`;

  it('allows requests under the limit', () => {
    const id = fresh();
    for (let i = 0; i < 20; i += 1) {
      expect(checkRateLimit(id, 'inference')).toEqual({ ok: true });
    }
  });

  it('blocks over the limit with a retry hint', () => {
    const id = fresh();
    for (let i = 0; i < 20; i += 1) checkRateLimit(id, 'inference');
    const blocked = checkRateLimit(id, 'inference');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('slides the window: old hits expire and free capacity', () => {
    const id = fresh();
    for (let i = 0; i < 20; i += 1) checkRateLimit(id, 'inference');
    expect(checkRateLimit(id, 'inference').ok).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit(id, 'inference')).toEqual({ ok: true });
  });

  it('keeps buckets independent', () => {
    const id = fresh();
    for (let i = 0; i < 20; i += 1) checkRateLimit(id, 'inference');
    expect(checkRateLimit(id, 'inference').ok).toBe(false);
    expect(checkRateLimit(id, 'mutation')).toEqual({ ok: true });
  });

  it('gives mutation the higher 60/min budget', () => {
    const id = fresh();
    for (let i = 0; i < 60; i += 1) {
      expect(checkRateLimit(id, 'mutation')).toEqual({ ok: true });
    }
    expect(checkRateLimit(id, 'mutation').ok).toBe(false);
  });

  it('keys by session so one abuser cannot starve another', () => {
    const abuser = fresh();
    for (let i = 0; i < 20; i += 1) checkRateLimit(abuser, 'inference');
    expect(checkRateLimit(abuser, 'inference').ok).toBe(false);
    expect(checkRateLimit(fresh(), 'inference')).toEqual({ ok: true });
  });
});
