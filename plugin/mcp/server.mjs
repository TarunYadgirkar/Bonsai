#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/* ---------- the real engine ----------
 * No more hand-mirrored subset: build.mjs aliases 'bonsai-engine' to packages/engine/src and
 * bundles the TypeScript source into dist/server.mjs, so the plugin routes with the actual
 * classifier (kind + confidence + coverage) and prices with the actual token math. The bundle
 * is the only supported way to RUN this file — `node server.mjs` unbundled cannot resolve the
 * TS engine, which is why the smoke exercises dist/server.mjs.
 */
import { estimateTokens, prunedPct, route as engineRoute, TIER_DEFAULTS } from 'bonsai-engine';

/* ---------- plugin routing ---------- */

const AGENT_TYPES = {
  quick: 'bonsai-branch-quick',
  thoughtful: 'bonsai-branch-thoughtful',
  deep: 'bonsai-branch-deep',
};

function tierForModel(modelId) {
  if (/haiku/i.test(modelId)) return 'quick';
  if (/sonnet/i.test(modelId)) return 'thoughtful';
  if (/opus|fable/i.test(modelId)) return 'deep';
  return null;
}

/**
 * Route through the real engine router (classifier kind + confidence + brief coverage), then
 * apply the plugin's pinned-model override the same way the web app honours manual picks.
 */
async function route(question, pinned, briefFacts) {
  const briefMarkdown = briefFacts.map((f) => `- ${f}`).join('\n');
  const brief = {
    id: 'plugin_brief',
    branchId: 'plugin_branch',
    selection: question.slice(0, 60),
    markdown: briefMarkdown,
    facts: briefFacts,
    excludedNote: '',
    availableTokens: Math.max(1, estimateTokens(briefMarkdown)),
    briefTokens: estimateTokens(briefMarkdown),
    prunedPct: 0,
  };
  const decision = await engineRoute({
    question,
    brief: briefFacts.length ? brief : undefined,
    contextTokens: estimateTokens(briefMarkdown),
  });
  const tier = (pinned?.model && tierForModel(pinned.model)) || decision.tier;
  return {
    tier,
    model: pinned?.model ?? TIER_DEFAULTS[tier].model,
    effort: pinned?.effort ?? TIER_DEFAULTS[tier].effort,
    agentType: AGENT_TYPES[tier],
    covered: briefFacts.length ? decision.coveredByBrief !== false : true,
  };
}

/* ---------- storage ---------- */

function dataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.bonsai');
}

function storePath() {
  return join(dataDir(), 'trees.json');
}

function loadStore() {
  try {
    return JSON.parse(readFileSync(storePath(), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`bonsai-mcp: unreadable ${storePath()}, starting fresh: ${error.message}`);
    return { trees: {} };
  }
}

function saveStore(store) {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = join(dataDir(), `trees.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, storePath());
}

/**
 * Cross-process mutex around load→mutate→save. Two Claude sessions running the plugin in the same
 * cwd would otherwise both load, both save, and the second clobbers the first's tree. mkdir is
 * atomic across processes; a lock older than STALE_MS is stolen so a crashed holder can't wedge it.
 */
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;
async function withStoreLock(fn) {
  mkdirSync(dataDir(), { recursive: true });
  const lockPath = join(dataDir(), 'trees.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // lock vanished between EEXIST and stat — retry acquire
      }
      if (Date.now() > deadline) throw new Error('bonsai-mcp: store lock timeout');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function treeKey(cwd) {
  return cwd || 'default';
}

function newId() {
  return `b_${randomBytes(3).toString('hex')}`;
}

function rootOf(nodes) {
  return Object.values(nodes).find((n) => n.parentId === null) ?? null;
}

function requireNode(tree, branchId) {
  const node = tree?.nodes[branchId];
  if (!node) throw new Error(`Unknown branchId ${branchId}. Run bonsai_tree to see current branches.`);
  return node;
}

/* ---------- brief rendering ---------- */

function renderBrief({ selection, question, briefFacts, excludedNote }) {
  const lines = [`# Branch brief — ${selection}`, '', '## Relevant facts'];
  for (const fact of briefFacts) lines.push(`- ${fact}`);
  if (excludedNote) lines.push('', excludedNote);
  lines.push('', '## Question', question);
  return lines.join('\n');
}

const SUBAGENT_INSTRUCTIONS = [
  'Answer the question using ONLY the brief above. Bring no other knowledge of this conversation.',
  'If the brief does not contain something the question needs, say so plainly instead of guessing.',
  'End your final message with a line of exactly this form:',
  'INSIGHT: <one sentence, ≤20 words, referents resolved — the single durable conclusion the parent should learn>',
].join('\n');

/**
 * The subagent's model is fixed by its tier's frontmatter, but effort is not a spawn parameter —
 * so the router's chosen effort is rendered into the prompt as an explicit reasoning-depth cue,
 * mirroring how the engine renders effort into the provider prompt.
 */
const EFFORT_DEPTH = {
  low: 'Reasoning depth — low: answer directly and briefly; do not over-deliberate.',
  medium: 'Reasoning depth — medium: think through the brief before answering.',
  high: 'Reasoning depth — high: reason carefully through the trade-offs before committing to an answer.',
  max: 'Reasoning depth — max: reason exhaustively through every constraint and trade-off before answering.',
};
function effortInstruction(effort) {
  const line = EFFORT_DEPTH[effort];
  return line ? `${line}\n\n` : '';
}

/* ---------- tool handlers ---------- */

// Rough full-copy counterfactual: what sending the whole parent context would cost,
// modeled as 20x the facts. Only used when the caller reports no real estimate.
const AVAILABLE_TOKENS_MULTIPLIER = 20;

function handleFork(args) {
  return withStoreLock(() => handleForkLocked(args));
}

async function handleForkLocked(args) {
  const key = treeKey(args.cwd);
  const store = loadStore();
  const now = new Date().toISOString();
  const tree = store.trees[key] ?? { nodes: {}, createdAt: now, updatedAt: now };
  const nodes = { ...tree.nodes };

  let root = rootOf(nodes);
  if (!root) {
    root = {
      id: newId(),
      title: 'session',
      parentId: null,
      briefFacts: [],
      briefTokens: 0,
      availableTokens: 0,
      prunedPct: 0,
      tier: null,
      model: null,
      effort: null,
      status: 'open',
      createdAt: now,
    };
    nodes[root.id] = root;
  }

  const parentId = args.parentId ?? root.id;
  if (!nodes[parentId]) throw new Error(`Unknown parentId ${parentId}. Run bonsai_tree to see current branches.`);

  // A re-fork of the same question off the same parent is a coverage retry, not a new branch —
  // supersede the prior still-open uncovered sibling so retries don't pile up as phantom branches
  // that inflate the tree's economics.
  for (const sibling of Object.values(nodes)) {
    if (
      sibling.parentId === parentId &&
      sibling.status === 'open' &&
      sibling.covered === false &&
      sibling.question === args.question
    ) {
      nodes[sibling.id] = { ...sibling, status: 'abandoned' };
    }
  }

  const routing = await route(args.question, args.pinned, args.briefFacts);
  const isCovered = routing.covered;
  const briefMarkdown = renderBrief(args);
  const briefTokens = estimateTokens(briefMarkdown);
  const factTokens = args.briefFacts.reduce((sum, fact) => sum + estimateTokens(fact), 0);
  const availableTokens = args.contextTokensEstimate ?? factTokens * AVAILABLE_TOKENS_MULTIPLIER;
  const pct = prunedPct(availableTokens, briefTokens);

  const node = {
    id: newId(),
    title: args.title ?? args.selection,
    parentId,
    selection: args.selection,
    question: args.question,
    briefFacts: args.briefFacts,
    ...(args.excludedNote ? { excludedNote: args.excludedNote } : {}),
    briefTokens,
    availableTokens,
    prunedPct: pct,
    tier: routing.tier,
    model: routing.model,
    effort: routing.effort,
    covered: isCovered,
    status: 'open',
    createdAt: now,
  };

  store.trees[key] = { ...tree, nodes: { ...nodes, [node.id]: node }, updatedAt: now };
  saveStore(store);

  return {
    branchId: node.id,
    agentType: routing.agentType,
    model: routing.model,
    effort: routing.effort,
    tier: routing.tier,
    covered: isCovered,
    briefTokens,
    availableTokens,
    availableTokensSource: args.contextTokensEstimate != null ? 'reported' : 'estimated',
    prunedPct: pct,
    briefMarkdown,
    subagentPrompt: `${briefMarkdown}\n\n---\n\n${effortInstruction(routing.effort)}${SUBAGENT_INSTRUCTIONS}`,
  };
}

const INSIGHT_MAX_WORDS = 20;

function cleanInsight(raw) {
  return raw.trim().replace(/^["'‘’“”]+|["'‘’“”]+$/g, '').trim();
}

function handleMerge(args) {
  return withStoreLock(() => handleMergeLocked(args));
}

function handleMergeLocked(args) {
  const insight = cleanInsight(args.insight);
  if (!insight) throw new Error('Insight is empty. Provide the one durable conclusion this branch reached.');
  const wordCount = insight.split(/\s+/).length;
  if (wordCount > INSIGHT_MAX_WORDS) {
    throw new Error(`Insight is ${wordCount} words; max ${INSIGHT_MAX_WORDS}. Distill to one sentence with referents resolved.`);
  }

  const key = treeKey(args.cwd);
  const store = loadStore();
  const tree = store.trees[key];
  const node = requireNode(tree, args.branchId);
  const now = new Date().toISOString();
  const updated = { ...node, status: 'merged', insight };
  store.trees[key] = { ...tree, nodes: { ...tree.nodes, [node.id]: updated }, updatedAt: now };
  saveStore(store);

  return {
    parentId: node.parentId,
    recordedInsight: insight,
    treeSummary: summarize(store.trees[key]),
  };
}

function handleAbandon(args) {
  return withStoreLock(() => handleAbandonLocked(args));
}

function handleAbandonLocked(args) {
  const key = treeKey(args.cwd);
  const store = loadStore();
  const tree = store.trees[key];
  const node = requireNode(tree, args.branchId);
  const now = new Date().toISOString();
  const updated = { ...node, status: 'abandoned' };
  store.trees[key] = { ...tree, nodes: { ...tree.nodes, [node.id]: updated }, updatedAt: now };
  saveStore(store);

  return { branchId: node.id, parentId: node.parentId, status: 'abandoned' };
}

function handleReset(args) {
  return withStoreLock(() => handleResetLocked(args));
}

function handleResetLocked(args) {
  const key = treeKey(args.cwd);
  if (args.confirm !== true) {
    return { deleted: false, treeKey: key, note: 'Pass confirm: true to delete this tree. Nothing was changed.' };
  }
  const store = loadStore();
  const existed = key in store.trees;
  if (existed) {
    const { [key]: _removed, ...rest } = store.trees;
    saveStore({ ...store, trees: rest });
  }
  return { deleted: existed, treeKey: key };
}

/* ---------- tree rendering ---------- */

const STATUS_GLYPH = { open: '○', merged: '✓', abandoned: '✕' };

function summarize(tree) {
  const branches = Object.values(tree.nodes).filter((n) => n.parentId !== null);
  const count = (status) => branches.filter((n) => n.status === status).length;
  // Abandoned branches never spent their tokens on an answer that was kept — exclude them from the
  // economics sums so a superseded coverage retry doesn't inflate the tree's pruned/available math.
  const counted = branches.filter((n) => n.status !== 'abandoned');
  const briefTokens = counted.reduce((sum, n) => sum + n.briefTokens, 0);
  const availableTokens = counted.reduce((sum, n) => sum + n.availableTokens, 0);
  return {
    branches: branches.length,
    open: count('open'),
    merged: count('merged'),
    abandoned: count('abandoned'),
    briefTokens,
    availableTokens,
    prunedPct: prunedPct(availableTokens, briefTokens),
  };
}

function nodeLine(node) {
  const routing = node.tier ? ` [${node.tier} · ${node.model} · ${node.effort}]` : '';
  const economics = ` ~${node.availableTokens}→${node.briefTokens} tok (${node.prunedPct}% pruned)`;
  return `${STATUS_GLYPH[node.status]} ${node.title}${routing}${economics}`;
}

function renderTree(tree) {
  const root = rootOf(tree.nodes);
  if (!root) return 'Empty tree. Fork a branch with bonsai_fork.';

  const byParent = new Map();
  for (const node of Object.values(tree.nodes)) {
    if (node.parentId === null) continue;
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  }
  for (const children of byParent.values()) {
    children.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  const lines = [root.title];
  const walk = (parentId, prefix) => {
    const children = byParent.get(parentId) ?? [];
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const childPrefix = prefix + (isLast ? '   ' : '│  ');
      lines.push(`${prefix}${isLast ? '└─' : '├─'} ${nodeLine(child)}`);
      if (child.status === 'merged' && child.insight) {
        lines.push(`${childPrefix}↳ ${child.insight}`);
      }
      walk(child.id, childPrefix);
    });
  };
  walk(root.id, '');

  const s = summarize(tree);
  lines.push(
    '',
    `${s.branches} branches · ${s.open} open ${STATUS_GLYPH.open} · ${s.merged} merged ${STATUS_GLYPH.merged} · ${s.abandoned} abandoned ${STATUS_GLYPH.abandoned}`,
    `context: ~${s.availableTokens} tok available → ${s.briefTokens} tok sent (${s.prunedPct}% pruned overall; available is an estimate)`,
  );
  return lines.join('\n');
}

function handleTree(args) {
  const tree = loadStore().trees[treeKey(args.cwd)];
  if (!tree) return 'Empty tree. Fork a branch with bonsai_fork.';
  return renderTree(tree);
}

/* ---------- server ---------- */

const jsonResult = (result) => ({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
const textResult = (text) => ({ content: [{ type: 'text', text }] });

const cwdParam = z.string().optional().describe('Working directory string keying the tree; omit for "default".');

const server = new McpServer({ name: 'bonsai', version: '0.1.0' });

server.registerTool(
  'bonsai_fork',
  {
    description:
      'Create a side-question branch off the current conversation. Persists the branch node, deterministically routes it (question complexity → tier → model + effort; a pinned model/effort overrides), and returns the rendered context brief plus a ready-to-use subagent prompt. The caller compiles the brief facts (≤8, referent-resolved); this server does no LLM calls.',
    inputSchema: {
      title: z.string().optional().describe('Short branch label; defaults to the selection.'),
      selection: z.string().min(1).describe('The highlighted text or topic the branch forks on.'),
      question: z.string().min(1).describe('The side question to answer on this branch.'),
      briefFacts: z.array(z.string().min(1)).min(1).max(8).describe('1-8 referent-resolved facts compiled for this branch.'),
      excludedNote: z.string().optional().describe('One line naming what was deliberately left out of the brief.'),
      parentId: z.string().optional().describe('Branch to fork from; defaults to the session root.'),
      contextTokensEstimate: z.number().int().positive().optional().describe('Real token size of the parent context this brief replaces, if known.'),
      pinned: z
        .object({
          model: z.string().optional(),
          effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
        })
        .optional()
        .describe('Manual routing override; skips the classifier.'),
      cwd: cwdParam,
    },
  },
  async (args) => jsonResult(await handleFork(args)),
);

server.registerTool(
  'bonsai_merge',
  {
    description:
      'Merge a branch back: record its distilled insight (one sentence, ≤20 words, referents resolved) and mark the branch merged. Returns the parent id and tree-wide context economics.',
    inputSchema: {
      branchId: z.string().min(1),
      insight: z.string().min(1).describe('The single durable conclusion, ≤20 words, referents resolved.'),
      cwd: cwdParam,
    },
  },
  async (args) => jsonResult(await handleMerge(args)),
);

server.registerTool(
  'bonsai_abandon',
  {
    description: 'Mark a branch abandoned. Nothing merges back to the parent.',
    inputSchema: {
      branchId: z.string().min(1),
      cwd: cwdParam,
    },
  },
  async (args) => jsonResult(await handleAbandon(args)),
);

server.registerTool(
  'bonsai_tree',
  {
    description:
      'Render the branch tree as ASCII: per-branch routing [tier · model · effort], context economics (available→brief tokens, pruned %), status glyphs (○ open, ✓ merged, ✕ abandoned), merged insights, and a totals footer.',
    inputSchema: { cwd: cwdParam },
  },
  async (args) => textResult(await handleTree(args)),
);

server.registerTool(
  'bonsai_reset',
  {
    description: 'Delete the stored tree for this cwd key. Destructive; requires confirm: true.',
    inputSchema: {
      confirm: z.boolean().describe('Must be exactly true to delete.'),
      cwd: cwdParam,
    },
  },
  async (args) => jsonResult(await handleReset(args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
