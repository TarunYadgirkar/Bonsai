import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { anchorCarriedThrough } from '@bonsai/engine';
import {
  MAX_NODES_PER_KEY,
  abandonNode,
  countNodes,
  createNode,
  getNode,
  listNodes,
  setInsight,
  storeMode,
  summarize,
  treeSummary,
  type McpNode,
  type TreeTotals,
} from '@/lib/mcp-store';

const MAX_INSIGHT_WORDS = 30;

const TIER_BY_MODEL: Record<string, string> = {
  haiku: 'quick',
  sonnet: 'thoughtful',
  opus: 'deep',
  fable: 'deep',
};

const STATUS_GLYPH: Record<McpNode['status'], string> = {
  open: '○',
  merged: '✓',
  abandoned: '✕',
};

const forkInput = z.object({
  parentId: z.string().max(64).optional(),
  question: z.string().min(1).max(2000),
  brief: z.string().min(1).max(24000),
  facts: z.array(z.string().max(500)).max(12).optional(),
  excludedNote: z.string().max(1000).optional(),
  model: z.enum(['haiku', 'sonnet', 'opus', 'fable']).default('sonnet'),
  effort: z.enum(['low', 'medium', 'high', 'max']).default('medium'),
  availableTokensEstimate: z.number().int().positive().optional(),
});

const totalsOutput = z.object({
  branches: z.number(),
  open: z.number(),
  merged: z.number(),
  abandoned: z.number(),
  availableTokens: z.number(),
  briefTokens: z.number(),
  prunedPct: z.number().nullable(),
});

const forkOutput = z.object({
  branchId: z.string(),
  routing: z.object({ model: z.string(), effort: z.string(), tier: z.string() }),
  economics: z.object({
    briefTokens: z.number(),
    availableTokens: z.number().nullable(),
    prunedPct: z.number().nullable(),
  }),
  /** True when the server pinned the parent brief's anchor fact the caller dropped. */
  anchorPinned: z.boolean(),
  pasteBlock: z.string(),
});

const mergeOutput = z.object({
  branchId: z.string(),
  insight: z.string(),
  totals: totalsOutput,
});

const treeNodeOutput = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(['open', 'merged', 'abandoned']),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  tier: z.string().nullable(),
  availableTokens: z.number().nullable(),
  briefTokens: z.number().nullable(),
  prunedPct: z.number().nullable(),
  insight: z.string().nullable(),
});

const treeOutput = z.object({
  nodes: z.array(treeNodeOutput),
  totals: totalsOutput,
});

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * User-controlled text (titles, merged insights) is rendered into the tree the model reads back.
 * Collapse newlines and control chars to one line so a crafted insight can't forge extra tree
 * rows or inject instruction-shaped lines into the output.
 */
function oneLine(text: string): string {
  // Control chars only (incl. newlines/tabs/DEL) collapse to a space; hyphens etc. survive.
  const stripped = Array.from(text, (ch) => (ch.codePointAt(0)! < 0x20 || ch === '\u007f' ? ' ' : ch)).join('');
  return stripped.replace(/\s{2,}/g, ' ').trim();
}

function storageNote(): string {
  return storeMode() === 'memory' ? '\n[storage: memory only — not persisted across restarts]' : '';
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

function economicsLine(node: McpNode): string {
  if (node.briefTokens === null) return '';
  if (node.availableTokens !== null && node.prunedPct !== null) {
    return `${fmt(node.availableTokens)} → ${fmt(node.briefTokens)} tokens · ${node.prunedPct}% pruned`;
  }
  return `brief ≈ ${fmt(node.briefTokens)} tokens (pass availableTokensEstimate to see pruned %)`;
}

function pasteBlock(node: McpNode): string {
  const lines = [
    `Bonsai branch ${node.id.slice(0, 8)} — a focused side-question forked from a larger conversation. Answer only this; the parent context you need is compiled below.`,
    '',
    'Brief:',
    node.brief ?? '',
  ];
  if (node.facts && node.facts.length > 0) {
    lines.push('', 'Facts:', ...node.facts.map((f, i) => `${i + 1}. ${f}`));
  }
  if (node.excludedNote) {
    lines.push('', `Deliberately excluded: ${node.excludedNote}`);
  }
  lines.push(
    '',
    `Question: ${node.question ?? ''}`,
    '',
    `When answered, distill the result to at most ${MAX_INSIGHT_WORDS} words, then in a chat with the Bonsai connector attached call bonsai_merge with branchId "${node.id}" and that insight.`,
  );
  return lines.join('\n');
}

function summaryLine(totals: TreeTotals): string {
  const econ =
    totals.prunedPct !== null
      ? ` · ${fmt(totals.availableTokens)}→${fmt(totals.briefTokens)} tokens (${totals.prunedPct}% pruned)`
      : '';
  return `${totals.branches} branches · ${totals.open} open · ${totals.merged} merged · ${totals.abandoned} abandoned${econ}`;
}

function nodeLine(node: McpNode): string {
  const parts = [`${STATUS_GLYPH[node.status]} ${node.title ? oneLine(node.title) : node.id.slice(0, 8)}`];
  if (node.model) parts.push(`[${node.tier} · ${node.model} · ${node.effort}]`);
  if (node.briefTokens !== null) {
    const avail = node.availableTokens !== null ? fmt(node.availableTokens) : '?';
    const pruned = node.prunedPct !== null ? ` (${node.prunedPct}% pruned)` : '';
    parts.push(`${avail}→${fmt(node.briefTokens)}${pruned}`);
  }
  return parts.join(' ');
}

function renderSubtree(node: McpNode, childrenOf: Map<string, McpNode[]>, prefix: string, lines: string[]): void {
  const children = childrenOf.get(node.id) ?? [];
  children.forEach((child, i) => {
    const isLast = i === children.length - 1;
    lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${nodeLine(child)}`);
    const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
    if (child.status === 'merged' && child.insight) {
      lines.push(`${childPrefix}↳ "${oneLine(child.insight)}"`);
    }
    renderSubtree(child, childrenOf, childPrefix, lines);
  });
}

function renderTree(nodes: McpNode[], totals: TreeTotals): string {
  if (nodes.length === 0) return `No branches yet. Call bonsai_fork to start.${storageNote()}`;
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => n.parentId === null || !ids.has(n.parentId));
  const childrenOf = new Map<string, McpNode[]>();
  for (const node of nodes) {
    if (node.parentId === null || !ids.has(node.parentId)) continue;
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
  }
  const lines: string[] = [];
  for (const root of roots) {
    lines.push(root.title ?? root.id);
    renderSubtree(root, childrenOf, '', lines);
  }
  lines.push('', `totals: ${summaryLine(totals)}`);
  return lines.join('\n') + storageNote();
}

function normalizeInsight(raw: string): { insight: string; error: string | null } {
  const insight = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (insight.length === 0) return { insight, error: 'Insight is empty after trimming. Send the distilled finding itself.' };
  const words = insight.split(/\s+/).length;
  if (words > MAX_INSIGHT_WORDS) {
    return { insight, error: `Insight is ${words} words — distill it to at most ${MAX_INSIGHT_WORDS} before merging.` };
  }
  return { insight, error: null };
}

export function registerBonsaiTools(server: McpServer, userKey: string): void {
  server.registerTool(
    'bonsai_fork',
    {
      title: 'Fork a Bonsai branch',
      description:
        'Fork a side-question into a new Bonsai branch with a compiled minimal context brief. ' +
        'BEFORE calling: compile the brief in this conversation — at most 8 self-contained facts, ' +
        "every referent resolved (no bare 'it', 'the deadline', 'that approach'; name the actual thing), " +
        'plus one line stating what was deliberately excluded. Send the compiled brief, never raw transcript. ' +
        'Returns a paste-ready brief for a NEW claude.ai chat, the branchId, the routing (model · effort), ' +
        'and the pruning economics. When forking off an existing branch (parentId set), carry the parent ' +
        "brief's FIRST fact as this brief's first fact — the server pins it for you if you drop it.",
      inputSchema: forkInput,
      outputSchema: forkOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ parentId, question, brief, facts, excludedNote, model, effort, availableTokensEstimate }) => {
      if ((await countNodes(userKey)) >= MAX_NODES_PER_KEY) {
        return textResult(
          `This garden has reached its ${MAX_NODES_PER_KEY}-branch limit. Merge or abandon branches before forking more.`,
          true,
        );
      }
      // A supplied parent must be one of this key's own nodes — never attach to another garden's
      // node or a fabricated id (which would then render as an orphan root).
      const parent = parentId ? await getNode(userKey, parentId) : null;
      if (parentId && !parent) {
        return textResult(`Unknown parentId "${parentId}" for this garden key.`, true);
      }

      // Facts render into the paste block AND become the anchor a descendant fork inherits —
      // collapse control chars now (same rule as titles/insights) so a crafted fact can't forge
      // instruction-shaped lines, and can't propagate them down the chain via the pin below.
      let briefFacts = facts?.length ? facts.map(oneLine) : null;

      // Referent closure across compositions, same invariant as the engine (anchorFact pinning):
      // a sub-branch whose question never names the chain's entity must still carry it, or its
      // brief compiles to a dangling "it". The caller is asked to carry the parent's top fact;
      // if the incoming brief dropped it, pin it server-side. The anchor is server-injected
      // without caller review, so it gets the same one-line collapsing regardless of source.
      const anchor = parent?.facts?.[0] ? oneLine(parent.facts[0]) : undefined;
      let briefText = brief;
      let anchorPinned = false;
      if (anchor) {
        const carrier = briefFacts?.length ? briefFacts : [briefText.split('\n')[0] ?? ''];
        if (!anchorCarriedThrough(anchor, carrier)) {
          briefFacts = [anchor, ...(briefFacts ?? [])];
          briefText = `- ${anchor}\n${briefText}`;
          anchorPinned = true;
        }
      }

      const briefTokens = Math.ceil(briefText.length / 4);
      const prunedPct = availableTokensEstimate
        ? Math.max(0, Math.round((1 - briefTokens / availableTokensEstimate) * 1000) / 10)
        : null;
      const node = await createNode({
        userKey,
        parentId: parentId ?? null,
        title: question.replace(/\s+/g, ' ').trim().slice(0, 60),
        question,
        brief: briefText,
        facts: briefFacts,
        excludedNote: excludedNote ?? null,
        model,
        effort,
        tier: TIER_BY_MODEL[model],
        availableTokens: availableTokensEstimate ?? null,
        briefTokens,
        prunedPct,
      });
      const paste = pasteBlock(node);
      const text = [
        `Branch created.`,
        `branchId: ${node.id}`,
        `Routing: ${model} · ${effort} (${node.tier})`,
        `Economics: ${economicsLine(node)}${storageNote()}`,
        ...(anchorPinned
          ? [`Note: the parent brief's anchor fact was missing and has been pinned as fact 1.`]
          : []),
        '',
        'Paste everything between the rules into a NEW claude.ai chat:',
        '─'.repeat(40),
        paste,
        '─'.repeat(40),
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: {
          branchId: node.id,
          routing: { model, effort, tier: node.tier ?? TIER_BY_MODEL[model] },
          economics: {
            briefTokens,
            availableTokens: availableTokensEstimate ?? null,
            prunedPct,
          },
          anchorPinned,
          pasteBlock: paste,
        },
      };
    },
  );

  server.registerTool(
    'bonsai_merge',
    {
      title: 'Merge a branch insight',
      description:
        `Merge a finished branch back: store its distilled insight (at most ${MAX_INSIGHT_WORDS} words) ` +
        'and mark the branch merged. Distill first — the insight is what the parent conversation inherits, ' +
        'not the branch transcript.',
      inputSchema: z.object({
        branchId: z.string().min(1),
        insight: z.string().min(1).max(600),
      }),
      outputSchema: mergeOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ branchId, insight: rawInsight }) => {
      const { insight, error } = normalizeInsight(rawInsight);
      if (error) return textResult(error, true);
      const node = await setInsight(branchId, insight, userKey);
      if (!node) return textResult(`Unknown branchId "${branchId}" for this garden key.`, true);
      const totals = await treeSummary(userKey);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Merged ${branchId}: "${insight}"\nTree: ${summaryLine(totals)}${storageNote()}`,
          },
        ],
        structuredContent: { branchId: node.id, insight, totals },
      };
    },
  );

  server.registerTool(
    'bonsai_abandon',
    {
      title: 'Abandon a branch',
      description: 'Mark a Bonsai branch abandoned — a dead end kept in the tree for the record. No insight is merged.',
      inputSchema: z.object({ branchId: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ branchId }) => {
      const node = await abandonNode(branchId, userKey);
      if (!node) return textResult(`Unknown branchId "${branchId}" for this garden key.`, true);
      return textResult(`Branch ${branchId} abandoned.${storageNote()}`);
    },
  );

  server.registerTool(
    'bonsai_tree',
    {
      title: 'Show the Bonsai tree',
      description:
        'Render this garden key\'s Bonsai tree: every branch with routing, token economics, ' +
        'status (open ○ / merged ✓ / abandoned ✕), merged insights, and totals.',
      inputSchema: z.object({}),
      outputSchema: treeOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const nodes = await listNodes(userKey);
      const totals = summarize(nodes);
      const structured = {
        nodes: nodes.map((n) => ({
          id: n.id,
          parentId: n.parentId,
          title: n.title,
          status: n.status,
          model: n.model,
          effort: n.effort,
          tier: n.tier,
          availableTokens: n.availableTokens,
          briefTokens: n.briefTokens,
          prunedPct: n.prunedPct,
          insight: n.insight,
        })),
        totals,
      };
      return {
        content: [{ type: 'text' as const, text: renderTree(nodes, totals) }],
        structuredContent: structured,
      };
    },
  );
}
