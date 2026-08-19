/**
 * Per-visitor session identity for the web demo. Each browser gets its own garden (its own tree,
 * logs, and learned profile) so one visitor's clubs never show up in another's. The id rides in an
 * httpOnly cookie; the store scopes every row to it. New session → empty root, not the fixture.
 *
 * With SESSION_SECRET set the cookie is `<id>.<sig>` (HMAC-SHA256, truncated) so ids can't be
 * forged in bulk to poison the population prior. Unset keeps the unsigned cookie — mock-first.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'bonsai_session';
const ONE_YEAR = 60 * 60 * 24 * 365;
const SIG_LENGTH = 24;

export interface Session {
  id: string;
  isNew: boolean;
}

let warnedUnsigned = false;

function secret(): string | undefined {
  const s = process.env.SESSION_SECRET;
  if (!s && !warnedUnsigned) {
    warnedUnsigned = true;
    console.warn('[session] SESSION_SECRET unset — session cookies are unsigned');
  }
  return s || undefined;
}

function sign(id: string, key: string): string {
  return createHmac('sha256', key).update(id).digest('base64url').slice(0, SIG_LENGTH);
}

function verify(value: string, key: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot === -1) return null;
  const id = value.slice(0, dot);
  const sig = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id, key));
  return sig.length === expected.length && timingSafeEqual(sig, expected) ? id : null;
}

function mintSession(): Session {
  return { id: `s_${crypto.randomUUID().replace(/-/g, '')}`, isNew: true };
}

export function resolveSession(request: Request): Session {
  const raw = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)bonsai_session=([^;]+)/.exec(raw);
  const key = secret();
  if (!match) return mintSession();
  const value = decodeURIComponent(match[1]);
  if (!key) return { id: value, isNew: false };
  const id = verify(value, key);
  // Invalid or unsigned cookie under a configured secret → fresh garden, never trust the id.
  return id ? { id, isNew: false } : mintSession();
}

function sessionCookie(id: string): string {
  const key = secret();
  const value = key ? `${id}.${sign(id, key)}` : id;
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR}`;
}

/** Attach the Set-Cookie header when the session was just minted, so the browser keeps its garden. */
export function withSession(res: Response, session: Session): Response {
  if (session.isNew) res.headers.append('Set-Cookie', sessionCookie(session.id));
  return res;
}
