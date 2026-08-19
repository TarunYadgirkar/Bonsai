/**
 * Shared SSE scaffolding for routes that stream one chat turn (chat + message replay).
 * Protocol (same for both):
 *   event: delta    data: {"text": "..."}
 *   event: restart  data: {"reason": "widened" | "escalated"}
 *   event: done     data: ChatResponse
 *   event: error    data: {"error": "..."}
 */
import { withSession, type Session } from '@/lib/session';
import type { TurnResult } from '@/lib/chat-turn';

export interface TurnTaps {
  onDelta: (text: string) => void;
  onRestart: (reason: 'widened' | 'escalated') => void;
}

export function sseTurnResponse(
  session: Session,
  run: (taps: TurnTaps) => Promise<TurnResult>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const turn = await run({
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
