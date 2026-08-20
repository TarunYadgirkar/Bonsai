import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCode,
  exchangeCode,
  getClient,
  keyForToken,
  pkceMatches,
  registerClient,
  revokeTokensForKey,
  validRedirectUri,
} from '../lib/oauth';

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

describe('oauth (memory mode)', () => {
  it('rejects non-https redirect uris except localhost', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://localhost:3334/cb')).toBe(true);
    expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
  });

  it('registers a public client and refuses one with no valid uris', async () => {
    const client = await registerClient(['https://claude.ai/cb'], 'Claude');
    expect(client?.clientId.startsWith('bc_')).toBe(true);
    expect(await getClient(client!.clientId)).toMatchObject({ clientName: 'Claude' });
    expect(await registerClient(['http://evil.example/cb'])).toBeNull();
  });

  it('runs the full code → token → key flow with PKCE, single-use', async () => {
    const client = await registerClient(['https://claude.ai/cb'], 'Claude');
    const { verifier, challenge } = pkcePair();
    const code = await createCode({
      clientId: client!.clientId,
      userKey: 'bk_testkey',
      redirectUri: 'https://claude.ai/cb',
      codeChallenge: challenge,
    });

    // wrong verifier fails without consuming a NEW code's validity semantics
    const bad = await exchangeCode({
      code,
      clientId: client!.clientId,
      redirectUri: 'https://claude.ai/cb',
      codeVerifier: 'wrong-verifier',
    });
    expect(bad).toBeNull();

    // the code was single-use: even the right verifier now fails
    const reused = await exchangeCode({
      code,
      clientId: client!.clientId,
      redirectUri: 'https://claude.ai/cb',
      codeVerifier: verifier,
    });
    expect(reused).toBeNull();

    // fresh code, right verifier → token → key
    const code2 = await createCode({
      clientId: client!.clientId,
      userKey: 'bk_testkey',
      redirectUri: 'https://claude.ai/cb',
      codeChallenge: challenge,
    });
    const token = await exchangeCode({
      code: code2,
      clientId: client!.clientId,
      redirectUri: 'https://claude.ai/cb',
      codeVerifier: verifier,
    });
    expect(token?.startsWith('bt_')).toBe(true);
    expect(await keyForToken(token!)).toBe('bk_testkey');
    expect(await keyForToken('bt_forged')).toBeNull();
  });

  it('pkceMatches is exact', () => {
    const { verifier, challenge } = pkcePair();
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(verifier + 'x', challenge)).toBe(false);
  });
});

describe('oauth token lifetime + revocation (memory mode)', () => {
  it('a revoked token stops resolving to its key', async () => {
    const { verifier, challenge } = pkcePair();
    const client = await registerClient(['https://claude.ai/cb'], 'Claude');
    const code = await createCode({
      clientId: client!.clientId,
      userKey: 'bk_revoke_me',
      redirectUri: 'https://claude.ai/cb',
      codeChallenge: challenge,
    });
    const token = await exchangeCode({
      code,
      clientId: client!.clientId,
      redirectUri: 'https://claude.ai/cb',
      codeVerifier: verifier,
    });
    expect(await keyForToken(token!)).toBe('bk_revoke_me');
    const revoked = await revokeTokensForKey('bk_revoke_me');
    expect(revoked).toBe(1);
    expect(await keyForToken(token!)).toBeNull();
  });
});
