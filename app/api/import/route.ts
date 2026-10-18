import { apiError, persistenceError } from '@/lib/api';
import { IMPORT_LIMITS, parseGardenImport } from '@/lib/import';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { buildTree, commit, listConversations, loadWorkingSet, newId, putConversation } from '@/lib/store';
import type { ImportResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > IMPORT_LIMITS.bytes) return null;
  const text = await request.text();
  return text.length > IMPORT_LIMITS.bytes ? null : text;
}

/**
 * POST /api/import — add a `bonsai-garden@1` or `espalier-garden@1` JSON export to THIS
 * session's garden. Every id is freshly minted and imported roots become extra trees, so an
 * import can never overwrite or reach into anything that already exists.
 */
export async function POST(request: Request): Promise<Response> {
  const session = resolveSession(request);
  // IP-keyed like demo seeding: each import writes up to thousands of rows, and a cookieless
  // caller would otherwise get a fresh session-keyed allowance on every request.
  const limit = checkRateLimit(clientIp(request), 'import');
  if (!limit.ok) return apiError(`import limit reached, try again in ${limit.retryAfterSeconds}s`, 429);

  // A JSON content type forces a CORS preflight, so a cross-site form cannot post here.
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return apiError('send the garden file as application/json', 415);
  }
  const text = await readCapped(request);
  if (text === null) return apiError(`file too large (the limit is ${IMPORT_LIMITS.bytes / 1_000_000} MB)`, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return apiError('not a JSON file: export a garden as JSON and import that', 400);
  }

  const result = parseGardenImport(raw, newId);
  if (!result.ok) return apiError(`not an importable garden: ${result.error}`, 400);

  try {
    const ws = await loadWorkingSet(session.id);
    for (const conversation of result.conversations) putConversation(ws, conversation);
    if ((await commit(ws)) === 'failed') return persistenceError();
    const response: ImportResponse = {
      rootId: ws.rootId,
      tree: buildTree(ws),
      conversations: listConversations(ws),
      imported: result.conversations.length,
    };
    return withSession(Response.json(response), session);
  } catch (err) {
    console.warn(`[import] failed (${(err as Error).message})`);
    return persistenceError();
  }
}
