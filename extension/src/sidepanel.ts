/**
 * Side panel — the Bonsai tree UI and the branch/merge flow. An extension page, so it lives
 * outside claude.ai's DOM and the SPA can't clobber it. It reads the conversation and pre-fills
 * composers through the content script; it never sends.
 */
import {
  TIER_DEFAULTS,
  modelSpec,
  recordFeedback,
  routingLabel,
  type RoutingDecision,
  type Tier,
} from '@bonsai/engine';
import { branchPrompt, compileBranch, mergePrompt } from './compile';
import type { ActiveInfo, ContentToPanel, PrefillResult, TreeResult } from './messages';
import { econLine, escapeHtml, renderTreeInto } from './render';
import { listNodes, loadProfile, putNode, saveProfile, updateNode, type TreeNode } from './store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TIERS: Tier[] = ['quick', 'thoughtful', 'deep'];

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function toContent<T>(msg: unknown): Promise<T | undefined> {
  const id = await activeTabId();
  if (id === undefined) return undefined;
  try {
    return (await chrome.tabs.sendMessage(id, msg)) as T;
  } catch {
    return undefined;
  }
}

/* ---------- branch flow ---------- */

let lastCompiled: { brief: import('@bonsai/engine').ContextBrief; routing: RoutingDecision } | null = null;
/** The conversation the current selection was made in, so compiling can't target the wrong chat. */
let selectionConversationId: string | null = null;

async function compile(): Promise<void> {
  const selection = $<HTMLTextAreaElement>('selection').value.trim();
  const question = $<HTMLTextAreaElement>('question').value.trim();
  const status = $<HTMLSpanElement>('compile-status');
  if (!selection && !question) {
    status.textContent = 'Add a selection or a question first.';
    return;
  }
  status.textContent = 'Reading the conversation…';

  const active = await toContent<ActiveInfo>({ type: 'GET_ACTIVE' });
  if (!active?.conversationId) {
    status.textContent = 'Open a Claude chat (or reload one that was already open — the content script attaches on page load), then compile.';
    return;
  }
  // The selection came from a specific chat; if the active tab has since moved to a different one,
  // compiling would read the wrong conversation. Stop and make the user reselect here.
  if (selectionConversationId && selectionConversationId !== active.conversationId) {
    status.textContent = 'That selection was from a different chat — reselect text in this one.';
    selectionConversationId = null;
    return;
  }
  const treeRes = await toContent<TreeResult>({ type: 'GET_TREE', conversationId: active.conversationId });
  if (!treeRes || !treeRes.ok) {
    status.textContent = `Could not read the chat${treeRes ? `: ${treeRes.reason}` : ''}.`;
    return;
  }

  const profile = await loadProfile();
  const compiled = await compileBranch({
    turns: treeRes.tree.path,
    selection,
    question,
    profile,
  });
  lastCompiled = compiled;
  status.textContent = '';
  renderPreview(compiled, active.conversationId, treeRes.tree.name);
}

function renderPreview(
  compiled: { brief: import('@bonsai/engine').ContextBrief; routing: RoutingDecision },
  parentConversationId: string,
  parentName: string,
): void {
  const { brief, routing } = compiled;
  const preview = $<HTMLDivElement>('preview');
  const recommended = routing.tier;

  preview.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'brief';
  box.innerHTML = `
    <strong>Compiled brief</strong>
    <ul>${brief.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    <div class="excluded">${escapeHtml(brief.excludedNote)}</div>
    <div class="econ">${econLine(brief.availableTokens, brief.briefTokens, brief.prunedPct)}</div>
  `;

  const label = document.createElement('label');
  label.textContent = 'Model & effort (Bonsai picked this — change it to teach the router)';
  const select = document.createElement('select');
  for (const t of TIERS) {
    const d = TIER_DEFAULTS[t];
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = routingLabel(d.model, d.effort);
    if (t === recommended) opt.selected = true;
    select.appendChild(opt);
  }
  if (routing.learned) {
    const note = document.createElement('div');
    note.className = 'econ';
    note.textContent = `Learned: ${routing.reason.split('. ').pop() ?? ''}`;
    box.appendChild(note);
  }

  const open = document.createElement('button');
  open.textContent = 'Open branch chat →';
  open.style.marginTop = '10px';
  open.addEventListener('click', () =>
    openBranch(brief, routing, select.value as Tier, recommended, parentConversationId, parentName),
  );

  preview.appendChild(box);
  preview.appendChild(label);
  preview.appendChild(select);
  preview.appendChild(open);
}

async function openBranch(
  brief: import('@bonsai/engine').ContextBrief,
  routing: RoutingDecision,
  chosenTier: Tier,
  recommendedTier: Tier,
  parentConversationId: string,
  parentName: string,
): Promise<void> {
  // A changed pick is a labeled correction — teach the local router. Attribute it to the
  // classifier's PRE-adjustment tier and carry the question kind, so per-kind learning trains.
  if (chosenTier !== recommendedTier) {
    const profile = await loadProfile();
    await saveProfile(
      recordFeedback(profile, {
        kind: 'override',
        classifiedTier: routing.classifiedTier ?? recommendedTier,
        chosenTier,
        questionKind: routing.kind,
      }),
    );
  }
  const model = TIER_DEFAULTS[chosenTier].model;
  const effort = TIER_DEFAULTS[chosenTier].effort;
  const question = $<HTMLTextAreaElement>('question').value.trim() || brief.selection;

  const node: TreeNode = {
    id: `n_${crypto.randomUUID().slice(0, 8)}`,
    conversationId: null,
    parentConversationId,
    title: (question || brief.selection).slice(0, 60),
    selection: brief.selection,
    question,
    briefMarkdown: brief.markdown,
    facts: brief.facts,
    excludedNote: brief.excludedNote,
    availableTokens: brief.availableTokens,
    briefTokens: brief.briefTokens,
    prunedPct: brief.prunedPct,
    tier: chosenTier,
    model,
    modelLabel: modelSpec(model).label,
    effort,
    status: 'draft',
    insight: null,
    createdAt: new Date().toISOString(),
  };
  await putNode(node);
  await chrome.runtime.sendMessage({
    type: 'OPEN_PREFILL',
    url: 'https://claude.ai/new',
    text: branchPrompt(brief, question),
    nodeId: node.id,
  });

  $<HTMLTextAreaElement>('selection').value = '';
  $<HTMLTextAreaElement>('question').value = '';
  $<HTMLDivElement>('preview').innerHTML = '';
  void parentName;
  await renderTree();
}

/* ---------- tree ---------- */

async function renderTree(): Promise<void> {
  const rendered = renderTreeInto($<HTMLDivElement>('tree'), await listNodes());
  for (const { node, el } of rendered) {
    if (node.status === 'open' || node.status === 'draft') el.appendChild(mergeControls(node));
  }
}

function mergeControls(node: TreeNode): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  const ta = document.createElement('textarea');
  ta.rows = 2;
  ta.placeholder = 'One distilled insight to merge back to the parent…';
  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '6px';

  const send = document.createElement('button');
  send.textContent = '⤴ Merge to parent';
  send.addEventListener('click', async () => {
    const insight = ta.value.trim();
    if (!insight) return;
    await updateNode(node.id, { status: 'merged', insight });
    await chrome.runtime.sendMessage({
      type: 'OPEN_PREFILL',
      url: `https://claude.ai/chat/${node.parentConversationId}`,
      text: mergePrompt(insight),
    });
    await renderTree();
  });

  const drop = document.createElement('button');
  drop.className = 'ghost';
  drop.textContent = 'Abandon';
  drop.addEventListener('click', async () => {
    await updateNode(node.id, { status: 'abandoned' });
    await renderTree();
  });

  row.appendChild(send);
  row.appendChild(drop);
  wrap.appendChild(ta);
  wrap.appendChild(row);
  return wrap;
}

/* ---------- wiring ---------- */

chrome.runtime.onMessage.addListener((msg: ContentToPanel) => {
  if (msg.type === 'SELECTION') {
    $<HTMLTextAreaElement>('selection').value = msg.text;
    // Remember which chat the text was selected in, so compile() can refuse a mismatched tab.
    selectionConversationId = msg.conversationId ?? null;
    $<HTMLTextAreaElement>('question').focus();
  }
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void renderTree();
});

$<HTMLButtonElement>('compile').addEventListener('click', () => void compile());
void renderTree();

// Prefill result type referenced for the content-script contract; keeps the import meaningful.
export type { PrefillResult };
