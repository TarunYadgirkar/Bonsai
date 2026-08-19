import { ChatRequestSchema } from '@/lib/api';
import { runChatTurn } from '@/lib/chat-turn';
import { resolveSession, withSession } from '@/lib/session';
import { loadWorkingSet } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Streaming twin of POST /api/chat. Same request contract, SSE out:
 *
 *   event: delta    data: {"text": "..."}          — a chunk of the current answer attempt
 *   event: restart  data: {"reason": "widened" | "escalated"} — discard the partial render
 *   event: done     data: ChatResponse             — the committed turn, same shape as /api/chat
 *   event: error    data: {"error": "..."}
 *
 * The buffered route stays for the extension, evals, and any client that prefers one JSON body.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      { error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid body' },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const turn = await runChatTurn({
          ws,
          sessionId: session.id,
          branchId: body.branchId,
          content: body.content,
          pinnedTier: body.pinnedTier,
          mode: body.mode,
          onDelta: (text) => send('delta', { text }),
          onRestart: (reason) => send('restart', { reason }),
        });
        if (turn.ok) send('done', turn.response);
        else send('error', { error: turn.error });
      } catch (err) {
        console.error('[api] stream unhandled', err);
        send('error', { error: 'internal error' });
      } finally {
        controller.close();
      }
    },
  });

  return withSession(
    new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    }),
    session,
  );
}
