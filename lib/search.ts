/**
 * Garden-wide search behind the ⌘K palette. Pure and client-side: the whole garden is already
 * in memory as StateResponse, so no API round-trip — every keystroke rescans.
 */
import type { Conversation } from './types';

export interface SearchHit {
  branchId: string;
  branchTitle: string;
  /** Where the query matched, title hits outrank insight hits outrank message hits. */
  kind: 'title' | 'insight' | 'message';
  /** A window of the matched text with the match roughly centred. */
  snippet: string;
  score: number;
}

const SNIPPET_RADIUS = 44;
const MAX_HITS = 20;
const KIND_WEIGHT: Record<SearchHit['kind'], number> = { title: 3, insight: 2, message: 1 };

function snippetAround(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + queryLength + SNIPPET_RADIUS);
  const clean = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${clean}${end < text.length ? '…' : ''}`;
}

/**
 * Every query term must appear somewhere in the field (AND semantics); the hit is anchored on
 * the first term's position. Scoring: field kind, then earliness of the match, then archived
 * branches sink — they're findable, just below the living wood.
 */
function matchField(
  text: string,
  terms: string[],
): { index: number; score: number } | null {
  const haystack = text.toLowerCase();
  let firstIndex = -1;
  for (const term of terms) {
    const at = haystack.indexOf(term);
    if (at === -1) return null;
    if (firstIndex === -1 || at < firstIndex) firstIndex = at;
  }
  return { index: firstIndex, score: 1 / (1 + firstIndex / 80) };
}

export function searchGarden(conversations: Conversation[], query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];

  for (const c of conversations) {
    const archivedPenalty = c.archived ? 0.5 : 1;
    const push = (kind: SearchHit['kind'], text: string) => {
      const match = matchField(text, terms);
      if (!match) return;
      hits.push({
        branchId: c.id,
        branchTitle: c.title,
        kind,
        snippet: kind === 'title' ? c.title : snippetAround(text, match.index, terms[0].length),
        score: KIND_WEIGHT[kind] * match.score * archivedPenalty,
      });
    };

    push('title', c.title);
    for (const insight of c.insights) push('insight', insight.text);
    for (const message of c.messages) push('message', message.content);
  }

  // One best hit per (branch, kind) so a term-heavy thread doesn't flood the list.
  const best = new Map<string, SearchHit>();
  for (const hit of hits) {
    const key = `${hit.branchId}:${hit.kind}`;
    const current = best.get(key);
    if (!current || hit.score > current.score) best.set(key, hit);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
}
