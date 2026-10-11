/**
 * Spoken-style tree commands typed into the composer: "side question: …" forks, "merge that"
 * merges, "never mind" sets the branch aside.
 *
 * Ported from Mahogany's voice grammar (lib/intent.ts there), where these phrases drove the
 * tree hands-free. Regex only, no model call: the check runs on every send and must cost
 * nothing. Patterns are anchored to the start of the message and narrower than the voice
 * originals, because a typed "can I ask about X?" is an ordinary question, not a fork.
 */
export type TurnCommand =
  | { kind: 'fork'; question: string }
  | { kind: 'merge' }
  | { kind: 'abandon' };

const FORK =
  /^(?:(?:hold on|hang on|wait|quick|real quick)[,.!]?\s+)?(?:(?:a\s+)?side\s+(?:question|thought)|tangent|btw|branch(?:\s+(?:off|here))?)\b\s*[:,.\-–—]?\s*([\s\S]*)$/i;

const MERGE =
  /^(?:(?:merge|keep|save)\s+(?:that|this|it)|remember\s+(?:that|this)|that'?s\s+(?:useful|good|it),?\s+merge\s+it|(?:go|take\s+me)\s+back\s+to\s+the\s+(?:main|trunk|original)(?:\s+thread)?)\s*[.!]?$/i;

const ABANDON =
  /^(?:never\s?mind|forget\s+(?:it|that)|drop\s+(?:it|that)|abandon\s+(?:this|that|it)(?:\s+branch)?|that\s+was\s+a\s+dead\s+end)\s*[.!]?$/i;

/** Shorter than this after the trigger phrase is not a question worth forking on. */
const MIN_QUESTION_CHARS = 4;

export function parseTurnCommand(text: string): TurnCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (ABANDON.test(trimmed)) return { kind: 'abandon' };
  if (MERGE.test(trimmed)) return { kind: 'merge' };
  const fork = FORK.exec(trimmed);
  if (fork) {
    const question = fork[1].trim();
    if (question.length >= MIN_QUESTION_CHARS) return { kind: 'fork', question };
  }
  return null;
}
