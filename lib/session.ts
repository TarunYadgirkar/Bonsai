/**
 * Per-visitor session identity for the web demo. Each browser gets its own garden (its own tree,
 * logs, and learned profile) so one visitor's clubs never show up in another's. The id rides in an
 * httpOnly cookie; the store scopes every row to it. New session → empty root, not the fixture.
 */
const COOKIE = 'bonsai_session';
const ONE_YEAR = 60 * 60 * 24 * 365;

export interface Session {
  id: string;
  isNew: boolean;
}

export function resolveSession(request: Request): Session {
  const raw = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)bonsai_session=([^;]+)/.exec(raw);
  if (match) return { id: decodeURIComponent(match[1]), isNew: false };
  return { id: `s_${crypto.randomUUID().replace(/-/g, '')}`, isNew: true };
}

function sessionCookie(id: string): string {
  return `${COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR}`;
}

/** Attach the Set-Cookie header when the session was just minted, so the browser keeps its garden. */
export function withSession(res: Response, session: Session): Response {
  if (session.isNew) res.headers.append('Set-Cookie', sessionCookie(session.id));
  return res;
}
