import { apiError } from '@/lib/api';
import { exportJson, exportMarkdown, type ExportScope } from '@/lib/export';
import { resolveSession, withSession } from '@/lib/session';
import { listConversations, loadWorkingSet } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/export?format=md|json[&branch=<id>] — download the garden (or one subtree) as a
 * file. Session-scoped like everything else; a branch id from another session just 404s.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'md';
  if (format !== 'md' && format !== 'json') return apiError('format must be md or json', 400);
  const branch = url.searchParams.get('branch');

  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id);
  const conversations = listConversations(ws);

  const scope: ExportScope = branch ? { kind: 'branch', id: branch } : { kind: 'garden' };
  if (branch && !conversations.some((c) => c.id === branch)) {
    return apiError(`unknown branch ${branch}`, 404);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `bonsai-${branch ? 'branch' : 'garden'}-${stamp}.${format}`;
  const body = format === 'md' ? exportMarkdown(conversations, scope) : exportJson(conversations, scope);
  const type = format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8';

  return withSession(
    new Response(body, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    }),
    session,
  );
}
