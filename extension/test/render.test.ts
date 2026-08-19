// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { escapeHtml, nodeCardHtml, renderTreeInto, econLine } from '../src/render';
import type { TreeNode } from '../src/store';

function node(over: Partial<TreeNode>): TreeNode {
  return {
    id: 'n1',
    conversationId: null,
    parentConversationId: 'p1',
    title: 'ML@B hours',
    selection: 'ML@B',
    question: 'How many hours?',
    briefMarkdown: '# brief',
    facts: ['ML@B is 12-14 hrs/week.'],
    excludedNote: 'rest excluded',
    availableTokens: 14000,
    briefTokens: 60,
    prunedPct: 99.6,
    tier: 'quick',
    model: 'claude-haiku-4-5',
    modelLabel: 'Haiku 4.5',
    effort: 'low',
    status: 'open',
    insight: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    ...over,
  };
}

describe('escapeHtml', () => {
  it('neutralizes HTML metacharacters (XSS guard for untrusted claude.ai text)', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtml(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;');
  });
});

describe('nodeCardHtml', () => {
  it('renders model, economics, and the status glyph', () => {
    const html = nodeCardHtml(node({}));
    expect(html).toContain('Haiku 4.5 · low');
    expect(html).toContain('~14000 tok available → 60 in the brief · 99.6% pruned');
    expect(html).toContain('○'); // open glyph
    expect(html).not.toContain('↳'); // no insight line when not merged
  });

  it('shows the insight line only when merged', () => {
    const html = nodeCardHtml(node({ status: 'merged', insight: 'ML@B costs 12-14 hrs/week.' }));
    expect(html).toContain('✓');
    expect(html).toContain('↳ ML@B costs 12-14 hrs/week.');
  });

  it('escapes a malicious title so it cannot inject markup', () => {
    const html = nodeCardHtml(node({ title: '<script>evil()</script>' }));
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
    expect(html).not.toContain('<script>evil');
  });
});

describe('renderTreeInto', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('shows the empty state with no nodes', () => {
    const out = renderTreeInto(container, []);
    expect(out).toEqual([]);
    expect(container.textContent).toContain('No branches yet');
  });

  it('renders one card per node, oldest first, returning elements for wiring', () => {
    const out = renderTreeInto(container, [
      node({ id: 'b', createdAt: '2026-08-11T02:00:00.000Z', title: 'second' }),
      node({ id: 'a', createdAt: '2026-08-11T01:00:00.000Z', title: 'first' }),
    ]);
    expect(out.map((o) => o.node.id)).toEqual(['a', 'b']); // sorted by createdAt
    expect(container.querySelectorAll('.node')).toHaveLength(2);
    expect(out[0].el.textContent).toContain('first');
  });
});

describe('econLine', () => {
  it('phrases growth honestly instead of "0% pruned"', () => {
    expect(econLine(54, 67, 0)).toBe('~54 tok thread → 67 tok brief · nothing to prune yet');
  });
  it('keeps the pruning phrasing when pruning actually happened', () => {
    expect(econLine(14000, 60, 99.6)).toBe('~14000 tok available → 60 in the brief · 99.6% pruned');
  });
});
