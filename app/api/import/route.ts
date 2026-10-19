import { apiError, persistenceError } from '@/lib/api';
import { GARDEN_LIMITS, IMPORT_LIMITS, parseGardenImport } from '@/lib/import';
import { checkSharedRateLimit, clientIp } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { buildTree, commitImport, listConversations, loadWorkingSet, newId } from '@/lib/store';
import type { Conversation, ImportResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The body as UTF-8 text, or null past IMPORT_LIMITS.bytes. Counted in bytes while it streams,
 * so a chunked upload with no content-length is cut off at the cap instead of buffered whole.
 */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > IMPORT_LIMITS.bytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > IMPORT_LIMITS.bytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Exactly application/json, parameters aside. A substring check would pass
 * "text/plain; x=application/json", which is CORS-safelisted and needs no preflight.
 */
function isJson(request: Request): boolean {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json';
}

const messageCount = (conversations: Conversation[]) => conversations.reduce((n, c) => n + c.messages.length, 0);

/**
 * POST /api/import — add a `bonsai-garden@1` or `espalier-garden@1` JSON export to THIS
 * session's garden. Every id is freshly minted and imported roots become extra trees, so an
 * import can never overwrite or reach into anything that already exists.
 */
export async function POST(request: Request): Promise<Response> {
  const session = resolveSession(request);
  // IP-keyed like demo seeding, and shared across instances when the database has the table:
  // each import writes up to a thousand rows, and a cookieless caller would otherwise get a
  // fresh session-keyed allowance on every request.
  const limit = await checkSharedRateLimit(clientIp(request), 'import');
  if (!limit.ok) return apiError(`import limit reached, try again in ${limit.retryAfterSeconds}s`, 429);

  // application/json is not CORS-safelisted, so a cross-site page must preflight, and nothing
  // here sends Access-Control-Allow-Origin to approve one.
  if (!isJson(request)) return apiError('send the garden file as application/json', 415);
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
    const existing = listConversations(ws);
    if (
      existing.length + result.conversations.length > GARDEN_LIMITS.conversations ||
      messageCount(existing) + messageCount(result.conversations) > GARDEN_LIMITS.messages
    ) {
      return apiError(
        `this garden is too full to import into (an import can bring it to at most ${GARDEN_LIMITS.conversations} conversations and ${GARDEN_LIMITS.messages} messages)`,
        413,
      );
    }
    if ((await commitImport(ws, result.conversations)) === 'failed') return persistenceError();
    const response: ImportResponse = {
      rootId: ws.rootId,
      tree: buildTree(ws),
      conversations: listConversations(ws),
      imported: result.conversations.length,
      insightsDropped: result.insightsDropped,
    };
    return withSession(Response.json(response), session);
  } catch (err) {
    console.warn(`[import] failed (${(err as Error).message})`);
    return persistenceError();
  }
}
