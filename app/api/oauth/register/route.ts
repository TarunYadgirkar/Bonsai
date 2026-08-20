import { registerClient } from '@/lib/oauth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** RFC 7591 Dynamic Client Registration — public clients only, no secrets issued. */
export async function POST(request: Request): Promise<Response> {
  const limit = checkRateLimit(clientIp(request), 'oauth');
  if (!limit.ok) {
    return Response.json({ error: 'rate_limit_exceeded' }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as {
    redirect_uris?: unknown;
    client_name?: unknown;
  } | null;
  const uris = Array.isArray(body?.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && u.length < 2000)
    : [];
  const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 120) : undefined;
  const client = await registerClient(uris, name);
  if (!client) {
    return Response.json(
      { error: 'invalid_client_metadata', error_description: 'at least one https redirect_uri required' },
      { status: 400 },
    );
  }
  return Response.json(
    {
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 },
  );
}
