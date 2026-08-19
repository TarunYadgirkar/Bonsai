import { createCode, getClient } from '@/lib/oauth';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { issueKeyForSession } from '@/lib/mcp-store';

export const dynamic = 'force-dynamic';

/**
 * Authorization endpoint. GET renders a consent page (sumi-e, self-contained); POST from its
 * Approve button mints/reuses the web session's garden key — the same identity /connect hands
 * out — binds a PKCE code to it, and redirects back to the client. Identity is the browser
 * session; there is no password because there is no account.
 */

interface AuthParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

function readParams(url: URL): { ok: true; p: AuthParams } | { ok: false; error: string } {
  const p = {
    clientId: url.searchParams.get('client_id') ?? '',
    redirectUri: url.searchParams.get('redirect_uri') ?? '',
    state: url.searchParams.get('state') ?? '',
    codeChallenge: url.searchParams.get('code_challenge') ?? '',
  };
  if (!p.clientId || !p.redirectUri) return { ok: false, error: 'client_id and redirect_uri required' };
  if ((url.searchParams.get('response_type') ?? 'code') !== 'code') {
    return { ok: false, error: 'only response_type=code is supported' };
  }
  if ((url.searchParams.get('code_challenge_method') ?? 'S256') !== 'S256') {
    return { ok: false, error: 'only S256 PKCE is supported' };
  }
  if (!p.codeChallenge) return { ok: false, error: 'code_challenge required (PKCE is mandatory)' };
  return { ok: true, p };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function consentPage(p: AuthParams, clientName: string): string {
  const qs = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    response_type: 'code',
  }).toString();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>Approve Bonsai access</title>
<style>
  body{margin:0;display:flex;min-height:100dvh;align-items:center;justify-content:center;
       background:#EEECE3;color:#20241E;font:14px/1.6 system-ui,sans-serif}
  .card{max-width:400px;background:#F6F4EC;border:1px solid #D8D4C6;border-radius:12px;padding:26px}
  h1{margin:0 0 4px;font:600 20px Georgia,serif}
  p{color:#5A5F52;font-size:13px}
  button{background:#3E6B47;color:#EEECE3;border:1px solid #3E6B47;border-radius:6px;
         padding:9px 16px;font:600 13px system-ui;cursor:pointer;width:100%;margin-top:14px}
  button:hover{background:#5E8C55}
  .who{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#20241E;
       background:#E7E4D8;border-radius:4px;padding:2px 6px}
  .note{font-size:11px;color:#8A7F6A;margin-top:12px}
</style></head><body>
<form class="card" method="post" action="/api/oauth/authorize?${esc(qs)}">
  <h1>🌱 Bonsai</h1>
  <p><span class="who">${esc(clientName)}</span> wants to connect to your Bonsai garden:
     fork side-questions with compiled briefs, merge insights back, and read your tree.</p>
  <button type="submit">Approve — grow my garden</button>
  <p class="note">Approving binds this browser's garden to the client. No account, no password —
     the grant can be severed by clearing this site's cookies before a future approval.</p>
</form></body></html>`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = readParams(url);
  if (!parsed.ok) return Response.json({ error: 'invalid_request', error_description: parsed.error }, { status: 400 });
  const client = await getClient(parsed.p.clientId);
  if (!client) return Response.json({ error: 'invalid_request', error_description: 'unknown client_id' }, { status: 400 });
  if (!client.redirectUris.includes(parsed.p.redirectUri)) {
    return Response.json({ error: 'invalid_request', error_description: 'redirect_uri not registered' }, { status: 400 });
  }
  const session = resolveSession(request);
  return withSession(
    new Response(consentPage(parsed.p, client.clientName ?? 'A Claude client'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    }),
    session,
  );
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = readParams(url);
  if (!parsed.ok) return Response.json({ error: 'invalid_request', error_description: parsed.error }, { status: 400 });
  const client = await getClient(parsed.p.clientId);
  if (!client || !client.redirectUris.includes(parsed.p.redirectUri)) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return Response.json({ error: 'rate_limit_exceeded' }, { status: 429 });

  const userKey = await issueKeyForSession(session.id);
  const code = await createCode({
    clientId: parsed.p.clientId,
    userKey,
    redirectUri: parsed.p.redirectUri,
    codeChallenge: parsed.p.codeChallenge,
  });
  const redirect = new URL(parsed.p.redirectUri);
  redirect.searchParams.set('code', code);
  if (parsed.p.state) redirect.searchParams.set('state', parsed.p.state);
  return withSession(Response.redirect(redirect.toString(), 302), session);
}
