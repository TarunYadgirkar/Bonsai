import { exchangeCode, TOKEN_TTL_SECONDS } from '@/lib/oauth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Token endpoint: authorization_code + PKCE only. Public clients — no client authentication. */
export async function POST(request: Request): Promise<Response> {
  const limit = checkRateLimit(clientIp(request), 'oauth');
  if (!limit.ok) return Response.json({ error: 'rate_limit_exceeded' }, { status: 429 });

  const form = await request.formData().catch(() => null);
  const get = (k: string) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v : '';
  };
  if (get('grant_type') !== 'authorization_code') {
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }
  const token = await exchangeCode({
    code: get('code'),
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    codeVerifier: get('code_verifier'),
  });
  if (!token) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  return Response.json(
    { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, scope: 'bonsai' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
