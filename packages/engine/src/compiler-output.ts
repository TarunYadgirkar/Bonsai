/**
 * The compiler's JSON contract, {"facts": string[], "excludedNote": string}, in its own module so
 * provider.ts can check a compile student's reply without importing the compiler (which imports
 * the provider chain).
 */
export interface CompilerJson {
  facts: string[];
  excludedNote?: string;
}

/** The first {...} span parsed, with non-string facts filtered out. Null unless a fact survives. */
export function parseCompilerJson(text: string): CompilerJson | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1)) as { facts?: unknown; excludedNote?: unknown };
    // Filter to strings FIRST, then gate on the result: a facts array of non-strings passes a
    // raw length check but filters to empty, yielding a factless brief that skips the fallback.
    const facts = Array.isArray(json.facts) ? json.facts.filter((f): f is string => typeof f === 'string') : [];
    if (!facts.length) return null;
    return { facts, ...(typeof json.excludedNote === 'string' ? { excludedNote: json.excludedNote } : {}) };
  } catch {
    return null;
  }
}
