/**
 * OAuth 2.1 authorization server for the MCP connector — the smallest honest implementation
 * that satisfies claude.ai's custom-connector flow: Dynamic Client Registration (public
 * clients, no secrets), PKCE S256 only, single-use short-lived codes, opaque bearer tokens
 * stored as sha256 hashes. Identity is the same per-user garden key the key-in-URL path uses —
 * the authorize page mints/reuses it via the web session, so OAuth is a carrier, not a second
 * account system. Memory fallback (no DATABASE_URL) keeps local dev keyless, per the
 * mock-first rule; those grants do not survive a restart and say so.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql, dbEnabled } from './db';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECT_URIS = 5;

export interface OauthClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
}

const memClients = new Map<string, OauthClient>();
const memCodes = new Map<
  string,
  { clientId: string; userKey: string; redirectUri: string; codeChallenge: string; expiresAt: number }
>();
const memTokens = new Map<string, { clientId: string; userKey: string }>();

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function opaque(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

/** HTTPS redirect URIs only (localhost excepted for tooling); claude.ai registers its own. */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export async function registerClient(
  redirectUris: string[],
  clientName?: string,
): Promise<OauthClient | null> {
  const uris = redirectUris.filter(validRedirectUri).slice(0, MAX_REDIRECT_URIS);
  if (uris.length === 0) return null;
  const client: OauthClient = { clientId: opaque('bc'), redirectUris: uris, clientName };
  if (dbEnabled()) {
    await sql()`
      INSERT INTO oauth_clients (client_id, redirect_uris, client_name)
      VALUES (${client.clientId}, ${JSON.stringify(uris)}::jsonb, ${clientName ?? null})
    `;
  } else {
    memClients.set(client.clientId, client);
  }
  return client;
}

export async function getClient(clientId: string): Promise<OauthClient | null> {
  if (dbEnabled()) {
    const rows = await sql()`SELECT client_id, redirect_uris, client_name FROM oauth_clients WHERE client_id = ${clientId}`;
    if (!rows.length) return null;
    return {
      clientId: rows[0].client_id as string,
      redirectUris: rows[0].redirect_uris as string[],
      clientName: (rows[0].client_name as string | null) ?? undefined,
    };
  }
  return memClients.get(clientId) ?? null;
}

export async function createCode(params: {
  clientId: string;
  userKey: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = opaque('ac');
  const expiresAt = Date.now() + CODE_TTL_MS;
  if (dbEnabled()) {
    await sql()`
      INSERT INTO oauth_codes (code, client_id, user_key, redirect_uri, code_challenge, expires_at)
      VALUES (${hash(code)}, ${params.clientId}, ${params.userKey}, ${params.redirectUri},
              ${params.codeChallenge}, ${new Date(expiresAt).toISOString()})
    `;
  } else {
    memCodes.set(hash(code), { ...params, expiresAt });
  }
  return code;
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge, compared constant-time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const derived = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(derived);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<string | null> {
  const key = hash(params.code);
  let row: { clientId: string; userKey: string; redirectUri: string; codeChallenge: string; expiresAt: number } | null =
    null;
  if (dbEnabled()) {
    const rows = await sql()`DELETE FROM oauth_codes WHERE code = ${key} RETURNING client_id, user_key, redirect_uri, code_challenge, expires_at`;
    if (rows.length) {
      row = {
        clientId: rows[0].client_id as string,
        userKey: rows[0].user_key as string,
        redirectUri: rows[0].redirect_uri as string,
        codeChallenge: rows[0].code_challenge as string,
        expiresAt: new Date(rows[0].expires_at as string).getTime(),
      };
    }
  } else {
    const mem = memCodes.get(key);
    if (mem) {
      memCodes.delete(key); // single-use in memory too
      row = mem;
    }
  }
  if (!row) return null;
  if (row.expiresAt < Date.now()) return null;
  if (row.clientId !== params.clientId || row.redirectUri !== params.redirectUri) return null;
  if (!pkceMatches(params.codeVerifier, row.codeChallenge)) return null;

  const token = opaque('bt');
  if (dbEnabled()) {
    await sql()`
      INSERT INTO oauth_tokens (token, client_id, user_key)
      VALUES (${hash(token)}, ${row.clientId}, ${row.userKey})
    `;
  } else {
    memTokens.set(hash(token), { clientId: row.clientId, userKey: row.userKey });
  }
  return token;
}

/** Bearer token → garden key. Null on anything unknown; DB errors reject (fail closed). */
export async function keyForToken(token: string): Promise<string | null> {
  if (!token.startsWith('bt_')) return null;
  const key = hash(token);
  if (dbEnabled()) {
    try {
      const rows = await sql()`
        UPDATE oauth_tokens SET last_used = now() WHERE token = ${key} RETURNING user_key
      `;
      return rows.length ? (rows[0].user_key as string) : null;
    } catch (err) {
      console.warn(`[oauth] token lookup failed (${(err as Error).message}) — rejecting`);
      return null;
    }
  }
  return memTokens.get(key)?.userKey ?? null;
}
