import { describe, expect, it } from 'vitest';
import { POST as seedRoute } from '../app/api/demo/route';
import { GET as stateRoute } from '../app/api/state/route';
import type { StateResponse } from '../lib/types';

let ipSeq = 0;
const freshIp = () => `203.0.113.${(ipSeq += 1)}`;

function demoRequest(opts: { ip: string; cookie?: string; replace?: boolean }): Request {
  return new Request('http://localhost/api/demo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': opts.ip,
      ...(opts.cookie ? { cookie: `bonsai_session=${opts.cookie}` } : {}),
    },
    body: JSON.stringify(opts.replace === undefined ? {} : { replace: opts.replace }),
  });
}

const ids = (state: StateResponse) => state.conversations.map((c) => c.id).sort();

describe('POST /api/demo', () => {
  it('seeds an empty garden, then returns it untouched on a second call', async () => {
    const ip = freshIp();
    const cookie = `s_seed_${Date.now()}`;
    const first = (await (await seedRoute(demoRequest({ ip, cookie }))).json()) as StateResponse;
    expect(first.conversations.length).toBeGreaterThan(1);

    const second = (await (await seedRoute(demoRequest({ ip, cookie }))).json()) as StateResponse;
    expect(ids(second)).toEqual(ids(first));
  });

  it('replaces the garden only when asked to', async () => {
    const ip = freshIp();
    const cookie = `s_replace_${Date.now()}`;
    const first = (await (await seedRoute(demoRequest({ ip, cookie }))).json()) as StateResponse;
    const replaced = (await (
      await seedRoute(demoRequest({ ip, cookie, replace: true }))
    ).json()) as StateResponse;
    expect(replaced.conversations.length).toBe(first.conversations.length);
    expect(ids(replaced)).not.toEqual(ids(first));
  });

  it('charges real seeds to the IP, so cookieless callers cannot seed without limit', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await seedRoute(demoRequest({ ip }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Another network is unaffected.
    expect((await seedRoute(demoRequest({ ip: freshIp() }))).status).toBe(200);
  });

  it('does not charge the IP for a garden that already has content', async () => {
    const ip = freshIp();
    const cookie = `s_noop_${Date.now()}`;
    await seedRoute(demoRequest({ ip, cookie }));
    for (let i = 0; i < 12; i += 1) {
      expect((await seedRoute(demoRequest({ ip, cookie }))).status).toBe(200);
    }
  });
});

describe('GET /api/state', () => {
  const stateRequest = (ip: string, cookie?: string) =>
    new Request('http://localhost/api/state', {
      headers: { 'x-forwarded-for': ip, ...(cookie ? { cookie: `bonsai_session=${cookie}` } : {}) },
    });

  it('limits session minting per IP but never a returning session', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) statuses.push((await stateRoute(stateRequest(ip))).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect((await stateRoute(stateRequest(ip, `s_returning_${Date.now()}`))).status).toBe(200);
  });
});
