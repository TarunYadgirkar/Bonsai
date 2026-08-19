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

/**
 * The economics fragment, phrased honestly: a tiny parent thread can compile to a brief BIGGER
 * than itself (structure + question overhead), and "0% pruned" next to growth reads like a bug.
 * Say what actually happened instead.
 */
export function econLine(availableTokens: number, briefTokens: number, prunedPct: number): string {
  if (prunedPct <= 0 || briefTokens >= availableTokens) {
    return `~${availableTokens} tok thread → ${briefTokens} tok brief · nothing to prune yet`;
  }
  return `~${availableTokens} tok available → ${briefTokens} in the brief · ${prunedPct}% pruned`;
}

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
      ${econLine(node.availableTokens, node.briefTokens, node.prunedPct)} · ${escapeHtml(node.status)}</div>
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
    container.innerHTML = `
      <div class="empty">
        <p style="margin:0 0 6px">No branches yet. The loop:</p>
        <ol style="margin:0;padding-left:16px">
          <li>Highlight text in any Claude chat → click the 🌱 Branch chip (or paste it above).</li>
          <li><b>Compile brief</b> — a minimal, self-contained context instead of the whole thread.</li>
          <li><b>Open branch chat</b> — Bonsai prefills it; you press send.</li>
          <li>Distill one line and <b>merge it back</b> to the parent.</li>
        </ol>
      </div>`;
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
