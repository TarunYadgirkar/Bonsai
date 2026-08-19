import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSession, withSession } from '../lib/session';

const SECRET = 'test-secret';

function requestWithCookie(value?: string): Request {
  return new Request('http://localhost/api/state', {
    headers: value ? { cookie: `bonsai_session=${value}` } : {},
  });
}

function setCookieValue(session: ReturnType<typeof resolveSession>): string {
  const res = withSession(new Response(null), session);
  const header = res.headers.get('set-cookie') ?? '';
  return decodeURIComponent(/bonsai_session=([^;]+)/.exec(header)?.[1] ?? '');
}

describe('resolveSession', () => {
  const saved = process.env.SESSION_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
  });

  describe('signed mode', () => {
    beforeEach(() => {
      process.env.SESSION_SECRET = SECRET;
    });

    it('round-trips a minted signed cookie', () => {
      const minted = resolveSession(requestWithCookie());
      expect(minted.isNew).toBe(true);

      const cookie = setCookieValue(minted);
      expect(cookie).toMatch(new RegExp(`^${minted.id}\\.[A-Za-z0-9_-]{24}$`));

      const resolved = resolveSession(requestWithCookie(encodeURIComponent(cookie)));
      expect(resolved).toEqual({ id: minted.id, isNew: false });
    });

    it('mints fresh on a tampered signature', () => {
      const minted = resolveSession(requestWithCookie());
      const [id, sig] = setCookieValue(minted).split('.');
      const flipped = sig[0] === 'A' ? 'B' : 'A';
      const tampered = `${id}.${flipped}${sig.slice(1)}`;

      const resolved = resolveSession(requestWithCookie(encodeURIComponent(tampered)));
      expect(resolved.isNew).toBe(true);
      expect(resolved.id).not.toBe(id);
    });

    it('mints fresh on an unsigned cookie', () => {
      const resolved = resolveSession(requestWithCookie('s_deadbeef'));
      expect(resolved.isNew).toBe(true);
      expect(resolved.id).not.toBe('s_deadbeef');
    });

    it('rejects a cookie signed with a different secret', () => {
      const minted = resolveSession(requestWithCookie());
      const cookie = setCookieValue(minted);

      process.env.SESSION_SECRET = 'other-secret';
      const resolved = resolveSession(requestWithCookie(encodeURIComponent(cookie)));
      expect(resolved.isNew).toBe(true);
    });
  });

  describe('unsigned mode', () => {
    beforeEach(() => {
      delete process.env.SESSION_SECRET;
    });

    it('passes an existing cookie through untouched', () => {
      const resolved = resolveSession(requestWithCookie('s_deadbeef'));
      expect(resolved).toEqual({ id: 's_deadbeef', isNew: false });
    });

    it('mints an unsigned cookie value', () => {
      const minted = resolveSession(requestWithCookie());
      expect(minted.isNew).toBe(true);
      expect(setCookieValue(minted)).toBe(minted.id);
    });
  });
});
