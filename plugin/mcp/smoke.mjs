#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'bonsai-mcp-smoke-'));

const child = spawn(process.execPath, [join(here, 'dist', 'server.mjs')], {
  env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

let nextId = 0;
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`));
    }, 5000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function callTool(name, args) {
  return request('tools/call', { name, arguments: args });
}

function toolJson(response) {
  assert.equal(response.error, undefined, `tool errored: ${JSON.stringify(response.error)}`);
  return JSON.parse(response.result.content[0].text);
}

function toolText(response) {
  assert.equal(response.error, undefined, `tool errored: ${JSON.stringify(response.error)}`);
  return response.result.content[0].text;
}

const CWD = '/tmp/demo-project';
const checks = [];
function check(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'bonsai-smoke', version: '0.0.0' },
  });
  assert.equal(init.result.serverInfo.name, 'bonsai');
  notify('notifications/initialized');
  check('initialize returns serverInfo.name=bonsai');

  const list = await request('tools/list', {});
  const names = list.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['bonsai_abandon', 'bonsai_fork', 'bonsai_merge', 'bonsai_reset', 'bonsai_tree']);
  const forkSchema = list.result.tools.find((t) => t.name === 'bonsai_fork').inputSchema;
  assert.equal(forkSchema.type, 'object');
  assert.ok(forkSchema.properties.briefFacts, 'fork schema exposes briefFacts');
  check('tools/list exposes all five tools with JSON schemas');

  const quick = toolJson(
    await callTool('bonsai_fork', {
      cwd: CWD,
      selection: 'Free Ventures',
      question: 'When do Free Ventures applications close?',
      briefFacts: [
        'Free Ventures applications close September 11, with an info session on September 3.',
        'Free Ventures is a student-run startup accelerator at Berkeley.',
      ],
      excludedNote: 'Excluded: the club-by-club comparison and workload math from the parent thread.',
    }),
  );
  assert.match(quick.branchId, /^b_[0-9a-f]{6}$/);
  assert.equal(quick.tier, 'quick');
  assert.equal(quick.model, 'claude-haiku-4-5');
  assert.equal(quick.effort, 'low');
  assert.equal(quick.agentType, 'bonsai-branch-quick');
  assert.equal(quick.covered, true);
  assert.equal(quick.availableTokensSource, 'estimated');
  assert.ok(quick.prunedPct >= 0 && quick.prunedPct <= 100);
  assert.ok(quick.briefMarkdown.startsWith('# Branch brief — Free Ventures'));
  assert.ok(quick.briefMarkdown.includes('## Relevant facts'));
  assert.ok(quick.briefMarkdown.includes('## Question'));
  assert.ok(quick.subagentPrompt.includes('INSIGHT:'));
  assert.ok(quick.subagentPrompt.includes('ONLY the brief'));
  check('bonsai_fork routes a short lookup to quick/haiku/low with covered=true');

  const deep = toolJson(
    await callTool('bonsai_fork', {
      cwd: CWD,
      title: 'club ranking',
      selection: 'club shortlist',
      question: 'Rank the three clubs by opportunity cost.',
      briefFacts: ['Tarun wants at most two clubs, builder-first and startup-adjacent.'],
      contextTokensEstimate: 4000,
    }),
  );
  assert.equal(deep.tier, 'deep');
  assert.equal(deep.model, 'claude-opus-5');
  assert.equal(deep.effort, 'high');
  assert.equal(deep.agentType, 'bonsai-branch-deep');
  assert.equal(deep.covered, false);
  assert.equal(deep.availableTokens, 4000);
  assert.equal(deep.availableTokensSource, 'reported');
  assert.ok(deep.prunedPct > 90, `expected heavy pruning, got ${deep.prunedPct}`);
  check('bonsai_fork routes a ranking question to deep/opus/high; reported tokens honored; uncovered brief flagged');

  const pinned = toolJson(
    await callTool('bonsai_fork', {
      cwd: CWD,
      selection: 'ML@B workload',
      question: 'Rank ML@B versus Blueprint on workload.',
      briefFacts: ['ML@B costs 12-14 hrs/week in the first semester; Blueprint fits the 8-10 hr cap.'],
      pinned: { model: 'claude-sonnet-5' },
    }),
  );
  assert.equal(pinned.tier, 'thoughtful');
  assert.equal(pinned.model, 'claude-sonnet-5');
  assert.equal(pinned.effort, 'medium');
  assert.equal(pinned.agentType, 'bonsai-branch-thoughtful');
  check('pinned model overrides the classifier (rank question stays on sonnet/thoughtful)');

  const treeBefore = toolText(await callTool('bonsai_tree', { cwd: CWD }));
  assert.ok(treeBefore.startsWith('session'));
  assert.ok(treeBefore.includes('○ Free Ventures'));
  assert.ok(treeBefore.includes('○ club ranking'));
  assert.ok(treeBefore.includes('[deep · claude-opus-5 · high]'));
  assert.ok(treeBefore.includes('3 branches'));
  check('bonsai_tree renders root, glyphs, routing brackets, totals footer');

  const tooLong = await callTool('bonsai_merge', {
    cwd: CWD,
    branchId: quick.branchId,
    insight:
      'This is a deliberately overlong insight that keeps adding words until it sails far past the twenty two word ceiling set by the server for merges.',
  });
  assert.equal(tooLong.result.isError, true);
  assert.match(toolText(tooLong), /max 20/);
  check('bonsai_merge rejects an insight over 20 words');

  const merged = toolJson(
    await callTool('bonsai_merge', {
      cwd: CWD,
      branchId: quick.branchId,
      insight: '"Free Ventures applications close September 11; the info session is September 3."',
    }),
  );
  assert.equal(merged.recordedInsight, 'Free Ventures applications close September 11; the info session is September 3.');
  assert.ok(merged.parentId, 'merge returns parentId');
  assert.equal(merged.treeSummary.merged, 1);
  assert.equal(merged.treeSummary.branches, 3);
  assert.ok(merged.treeSummary.prunedPct > 0);
  check('bonsai_merge strips quotes, records insight, returns treeSummary');

  const abandoned = toolJson(await callTool('bonsai_abandon', { cwd: CWD, branchId: deep.branchId }));
  assert.equal(abandoned.status, 'abandoned');
  check('bonsai_abandon marks the branch abandoned');

  const treeAfter = toolText(await callTool('bonsai_tree', { cwd: CWD }));
  assert.ok(treeAfter.includes('✓ Free Ventures'));
  assert.ok(treeAfter.includes('↳ Free Ventures applications close September 11'));
  assert.ok(treeAfter.includes('✕ club ranking'));
  assert.ok(treeAfter.includes('1 open ○ · 1 merged ✓ · 1 abandoned ✕'));
  check('bonsai_tree shows merged insight line and updated glyphs');

  const persisted = JSON.parse(readFileSync(join(dataDir, 'trees.json'), 'utf8'));
  assert.ok(persisted.trees[CWD], 'tree persisted under cwd key');
  assert.equal(Object.keys(persisted.trees[CWD].nodes).length, 4);
  check('trees.json persisted atomically with root + 3 branches');

  const noConfirm = toolJson(await callTool('bonsai_reset', { cwd: CWD, confirm: false }));
  assert.equal(noConfirm.deleted, false);
  const confirmed = toolJson(await callTool('bonsai_reset', { cwd: CWD, confirm: true }));
  assert.equal(confirmed.deleted, true);
  const afterReset = JSON.parse(readFileSync(join(dataDir, 'trees.json'), 'utf8'));
  assert.equal(afterReset.trees[CWD], undefined);
  check('bonsai_reset refuses without confirm, deletes only that tree key with confirm');

  console.log(`\nsmoke: ${checks.length}/${checks.length} checks passed`);
  process.exitCode = 0;
} catch (error) {
  console.error(`\nsmoke FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  child.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
