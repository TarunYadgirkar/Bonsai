import { describe, expect, it } from 'vitest';
import { parseTurnCommand } from '../src/commands';

describe('parseTurnCommand', () => {
  it.each([
    ['side question: when does Blueprint interview?', 'when does Blueprint interview?'],
    ['Hold on, side question, how big is the Hertz stipend?', 'how big is the Hertz stipend?'],
    ['wait side thought - is ML@B worth the spike?', 'is ML@B worth the spike?'],
    ['tangent: what does Codebase build?', 'what does Codebase build?'],
    ['btw, what time is the info session', 'what time is the info session'],
    ['branch off: compare the two deadlines', 'compare the two deadlines'],
  ])('forks on %j', (text, question) => {
    expect(parseTurnCommand(text)).toEqual({ kind: 'fork', question });
  });

  it.each(['merge that', 'Keep this.', 'remember that', "that's useful, merge it", 'take me back to the trunk'])(
    'merges on %j',
    (text) => {
      expect(parseTurnCommand(text)).toEqual({ kind: 'merge' });
    },
  );

  it.each(['never mind', 'Nevermind.', 'forget it', 'drop that', 'abandon this branch', 'that was a dead end'])(
    'abandons on %j',
    (text) => {
      expect(parseTurnCommand(text)).toEqual({ kind: 'abandon' });
    },
  );

  it.each([
    'Which clubs should I join?',
    'Can I ask about the Free Ventures deadline?',
    'This is a side question about clubs',
    'I want to keep that option open, what else?',
    'never mind the deadline, what about workload?',
    'side question:',
    'btw ok',
    'branch prediction is how CPUs guess',
    'btw what time is it',
    'tangent lines touch a curve once',
    '',
    'Merge that with the earlier plan and rank them',
  ])('leaves %j as an ordinary message', (text) => {
    expect(parseTurnCommand(text)).toBeNull();
  });
});
