import { canonicalOrigin } from '@/lib/origin';
/** RFC 9728 Protected Resource Metadata — how claude.ai discovers the authorization server. */
export function GET(request: Request): Response {
  const origin = canonicalOrigin(request);
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
