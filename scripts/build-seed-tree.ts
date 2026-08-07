/**
 * Regenerates `fixtures/seed-tree.json` — the pre-built branch tree the app boots with.
 *
 *   DATABASE_URL= npx next dev -p 3111        # in-memory, so this never touches the demo snapshot
 *   npx tsx scripts/build-seed-tree.ts
 *
 * Every branch here is produced by the real engine over the real API, so the briefs, pruned-%,
 * routing decisions and costs in the fixture are computed, not hand-written. Timestamps are
 * normalized to a fixed date afterwards so re-running produces a clean diff.
 *
 * Scenarios covered, one branch each: an auto-routed lookup, an auto-routed synthesis, an
 * auto-routed deep ranking, a nested branch off a branch, a manual Opus/max override, and an
 * off-brief question the compiled brief declines.
 *
 * Nothing is pre-merged. Beat 4 merges on stage, and POST /api/reset has to return the tree to
 * a state where that merge has not happened yet, so it can be shown again.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { Conversation, InferenceLog, ModeSelection } from '../lib/types';

const BASE = process.env.BONSAI_BASE ?? 'http://localhost:3111';
const OUT = path.join(process.cwd(), 'fixtures', 'seed-tree.json');
/** Fixed so regenerating the fixture doesn't churn every timestamp in the diff. */
const STAMP = '2026-08-07T18:00:00.000Z';

interface Scenario {
  note: string;
  parent: 'root' | number;
  selection: string;
  question: string;
  title?: string;
  mode?: ModeSelection;
  /** Extra turns asked after the branch exists, to show a branch mid-conversation. */
  followUps?: { content: string; mode?: ModeSelection }[];
  merge?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    // NOT pre-merged: Beat 4 merges this live on stage, and Reset has to put it back to
    // unmerged so the merge can be shown again. A pre-merged fixture would also mean merging
    // an already-merged branch during the demo.
    note: 'auto → cheapest model: single fact straight out of the brief',
    parent: 'root',
    selection: 'Free Ventures',
    question: 'when do apps close?',
    title: 'Free Ventures club inquiry',
  },
  {
    note: 'auto → synthesis over a few facts',
    parent: 'root',
    selection: 'ML@B',
    question: 'how many hours a week is ML@B really, once the education track is counted?',
    title: 'ML@B club workload inquiry',
  },
  {
    note: 'auto → Opus 5 / high: multi-constraint ranking, the cheap-vs-strong contrast',
    parent: 'root',
    selection: 'which clubs to join',
    question:
      "Given my goals, workload, and everything we've learned, rank my top 3 clubs and explain the opportunity cost of each.",
    // No follow-up here on purpose: the node badge shows the LAST turn's tier, and a cheap
    // follow-up would flip this branch's Opus chip to Haiku — the contrast the demo is built on.
    title: 'Top 3 clubs ranking inquiry',
  },
  {
    note: 'nested branch — depth 2, inherits a brief compiled from a brief',
    parent: 2,
    selection: 'opportunity cost',
    question: 'why is Codebase dominated in every scenario?',
    title: 'Codebase club inquiry',
    // The multi-turn example lives here: this branch already routes to the cheapest model, so an
    // extra cheap turn costs no chip. On the Opus or Sonnet branch it would overwrite theirs —
    // the node chip shows the LAST turn's decision.
    followUps: [{ content: 'what changes if I only have 8 hours a week?' }],
  },
  {
    note: 'manual override — the ceiling model at max effort on a question Auto would route cheap',
    parent: 'root',
    selection: 'Blueprint',
    question: 'is Blueprint worth it if I already have a technical peer group?',
    title: 'Blueprint club inquiry',
    mode: { mode: 'manual', model: 'claude-fable-5', effort: 'max' },
  },
  {
    note: 'guardrail — off-brief question the compiled brief refuses rather than inventing',
    parent: 'root',
    selection: 'Berkeley',
    question: 'what is the tuition of Berkeley law school?',
    title: 'Law school tuition inquiry (off-brief)',
    mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
  },
];

async function api<T>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${route} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const state = await api<{ rootId: string; tree: { id: string }[] }>('/api/state');
  if (state.tree.length > 1) {
    throw new Error(
      `${BASE} already has ${state.tree.length} nodes — restart the dev server so the tree is just the root`,
    );
  }

  const created: string[] = [];

  for (const [i, s] of SCENARIOS.entries()) {
    const parentId = s.parent === 'root' ? state.rootId : created[s.parent];
    if (!parentId) throw new Error(`scenario ${i} wants branch ${s.parent}, which does not exist`);

    const branch = await api<{ node: { id: string }; routing?: { tier: string; model: string } }>(
      '/api/branch',
      {
        parentId,
        selection: s.selection,
        question: s.question,
        title: s.title,
        mode: s.mode,
      },
    );
    created.push(branch.node.id);
    console.log(
      `${branch.node.id} ${s.title ?? s.selection} → ${branch.routing?.tier}/${branch.routing?.model}`,
    );

    for (const turn of s.followUps ?? []) {
      await api('/api/chat', { branchId: branch.node.id, content: turn.content, mode: turn.mode });
    }
    if (s.merge) {
      await api('/api/merge', { branchId: branch.node.id, archive: false });
      console.log(`  merged into ${parentId}`);
    }
  }

  const final = await api<{ rootId: string; conversations: Conversation[] }>('/api/state');
  const economics = await api<{ logs: InferenceLog[] }>('/api/economics');
  const root = final.conversations.find((c) => c.id === final.rootId);
  if (!root) throw new Error('root missing from final state');

  // The root's transcript stays in seed-conversation.json — only what the branches added is frozen
  // here, so rule 5 (do not rewrite the seed conversation) still holds.
  const fixture = {
    note: 'Generated by scripts/build-seed-tree.ts. Do not hand-edit — regenerate instead.',
    generatedFrom: SCENARIOS.map((s) => ({ title: s.title ?? s.selection, scenario: s.note })),
    rootInsights: normalize(root.insights),
    branches: normalize(final.conversations.filter((c) => c.id !== final.rootId)),
    logs: normalize(economics.logs),
    seq: nextSeq(final.conversations, economics.logs),
  };

  await fs.writeFile(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(
    `\nwrote ${OUT}: ${fixture.branches.length} branches, ${fixture.logs.length} logs, seq ${fixture.seq}`,
  );
}

/** Freeze every timestamp so regenerating the fixture produces a readable diff. */
function normalize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val) =>
      (key === 'createdAt' || key === 'ts') && typeof val === 'string' ? STAMP : val,
    ),
  ) as T;
}

/** ids are `<prefix>_<seq>`; the store must resume above every id it just loaded. */
function nextSeq(conversations: Conversation[], logs: InferenceLog[]): number {
  const ids = [
    ...conversations.flatMap((c) => [c.id, c.brief?.id, ...c.messages.map((m) => m.id), ...c.insights.map((i) => i.id)]),
    ...logs.map((l) => l.id),
  ];
  return ids.reduce((max, id) => {
    const n = Number(String(id).split('_').pop());
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

main().catch((err) => {
  console.error(`build-seed-tree failed: ${(err as Error).message}`);
  process.exit(1);
});
