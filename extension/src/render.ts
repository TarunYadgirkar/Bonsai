/**
 * Pure DOM rendering for the side panel — no chrome APIs, so it is unit-testable under jsdom.
 * The interactive handlers (merge/abandon, which need chrome messaging) are wired in sidepanel.ts.
 */
import type { TreeNode } from './store';

const GLYPH: Record<TreeNode['status'], string> = {
  draft: '◌',
  open: '○',
  merged: '✓',
  abandoned: '✕',
};

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** The read-only card for one branch: title + glyph, model/effort/economics, insight if merged. */
export function nodeCardHtml(node: TreeNode): string {
  return `
    <div class="title"><span class="glyph-${node.status}">${GLYPH[node.status]}</span> ${escapeHtml(node.title)}</div>
    <div class="meta"><span class="chip">${escapeHtml(node.modelLabel)} · ${escapeHtml(node.effort)}</span>
      ~${node.availableTokens}→${node.briefTokens} tok · ${node.prunedPct}% pruned · ${escapeHtml(node.status)}</div>
    ${node.insight ? `<div class="insight">↳ ${escapeHtml(node.insight)}</div>` : ''}
  `;
}

/** Build the tree list (oldest first) into `container`, returning the node elements for wiring. */
export function renderTreeInto(
  container: HTMLElement,
  nodes: TreeNode[],
): { node: TreeNode; el: HTMLElement }[] {
  const sorted = [...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!sorted.length) {
    container.innerHTML = '<p class="empty">No branches yet.</p>';
    return [];
  }
  container.innerHTML = '';
  const out: { node: TreeNode; el: HTMLElement }[] = [];
  for (const node of sorted) {
    const el = document.createElement('div');
    el.className = 'node';
    el.innerHTML = nodeCardHtml(node);
    container.appendChild(el);
    out.push({ node, el });
  }
  return out;
}
