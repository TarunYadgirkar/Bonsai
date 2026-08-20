import { canonicalOrigin } from '@/lib/origin';
/** RFC 8414 Authorization Server Metadata. PKCE S256 only; public clients via DCR. */
export function GET(request: Request): Response {
  const origin = canonicalOrigin(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['bonsai'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
