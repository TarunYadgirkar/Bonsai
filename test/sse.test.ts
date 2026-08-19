import { describe, expect, it } from 'vitest';
import { createSseParser } from '../lib/sse';

describe('createSseParser', () => {
  it('parses complete frames and holds partial ones across chunks', () => {
    const parse = createSseParser();
    expect(parse('event: delta\ndata: {"text":"He')).toEqual([]);
    expect(parse('llo"}\n\nevent: del')).toEqual([
      { event: 'delta', data: '{"text":"Hello"}' },
    ]);
    expect(parse('ta\ndata: {"text":" world"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":" world"}' },
    ]);
  });

  it('handles several frames in one chunk and defaults the event name', () => {
    const parse = createSseParser();
    expect(parse('data: a\n\nevent: done\ndata: b\n\n')).toEqual([
      { event: 'message', data: 'a' },
      { event: 'done', data: 'b' },
    ]);
  });

  it('ignores frames with no data', () => {
    const parse = createSseParser();
    expect(parse('event: ping\n\n')).toEqual([]);
  });
});
