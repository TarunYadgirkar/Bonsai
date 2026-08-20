/**
 * The canonical public origin for OAuth discovery documents and redirects. Trusting
 * `new URL(request.url).origin` lets a spoofed Host header steer the issuer/endpoints a client
 * discovers (and those responses are cacheable) — so a configured BONSAI_ORIGIN wins, and the
 * request origin is only the fallback for local dev where no such env is set.
 */
export function canonicalOrigin(request: Request): string {
  const configured = process.env.BONSAI_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');
  return new URL(request.url).origin;
}
