import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '../lib/db';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function hangingFetch() {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }),
  );
}

describe('Neon query timeout', () => {
  it('aborts a request that never answers', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    await expect(fetchWithTimeout(20)('https://neon.invalid/sql')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('still honours a caller signal', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = fetchWithTimeout(10_000)('https://neon.invalid/sql', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends every driver query through the timed fetch', async () => {
    const fetchFn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      throw new Error('neon down');
    });
    vi.stubGlobal('fetch', fetchFn);
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@ep-test.neon.invalid/neondb');
    const { checkKey } = await import('../lib/mcp-store');
    expect(await checkKey('bk_someone')).toBe('unavailable');
    expect(fetchFn).toHaveBeenCalled();
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('connector auth while the store is down', () => {
  it('answers 503 with Retry-After instead of calling a good key wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('neon down');
    }));
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@ep-test.neon.invalid/neondb');
    const { POST } = await import('../app/api/mcp/[key]/route');
    const res = await POST(new Request('http://localhost/api/mcp/bk_someone', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ key: 'bk_someone' }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
  });
});
