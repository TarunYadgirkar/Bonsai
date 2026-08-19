/**
 * Minimal incremental SSE parser for the streaming chat route. Fetch-based (EventSource can't
 * POST): feed it decoded chunks as they arrive, get completed events back. Frames split on the
 * blank line; a partial frame stays buffered until its terminator shows up.
 */
export interface SseEvent {
  event: string;
  data: string;
}

export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = '';
  return (chunk: string): SseEvent[] => {
    buffer += chunk;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    const events: SseEvent[] = [];
    for (const frame of frames) {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) events.push({ event, data });
    }
    return events;
  };
}
