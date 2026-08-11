/**
 * Content script — the only part of Bonsai that touches the claude.ai page. It reads the
 * conversation (GET-only, via claude-api), shows a "Branch" chip on a text selection, and
 * pre-fills the composer. It NEVER sends: no click on the send button, no Enter dispatch. The
 * human presses send. That rule is enforced structurally — there is no send code in the bundle.
 */
import { conversationIdFromUrl, conversationTree } from './claude-api';
import {
  PENDING_KEY,
  type ActiveInfo,
  type PanelToContent,
  type PendingBranch,
  type PrefillResult,
  type TreeResult,
} from './messages';

const COMPOSER_SELECTORS = [
  '[aria-label="Write your prompt to Claude"]',
  'div.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"].ProseMirror',
];

function findComposer(): HTMLElement | null {
  for (const sel of COMPOSER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

/**
 * Pre-fill the ProseMirror composer, then STOP — the human presses send.
 *
 * Verified against live claude.ai (Aug 2026): execCommand('insertText'), synthetic paste, and
 * beforeinput all no-op on the current ProseMirror build; replacing the editor's paragraph and
 * firing `input` is what actually lands text and lets the observer reconcile. execCommand is kept
 * as a first attempt in case a future build restores it.
 */
function prefillComposer(text: string): PrefillResult {
  const el = findComposer();
  if (!el) return { ok: false, reason: 'composer not found' };
  el.focus();

  if (document.execCommand('insertText', false, text) && el.textContent?.includes(text)) {
    return { ok: true };
  }

  // ProseMirror renders each line as its own <p>; split so newlines survive.
  const frag = document.createDocumentFragment();
  for (const line of text.split('\n')) {
    const p = document.createElement('p');
    p.textContent = line;
    frag.appendChild(p);
  }
  el.replaceChildren(frag);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: el.textContent?.includes(text.split('\n')[0]) ?? false };
}

/* ---------- selection → Branch chip ---------- */

let chip: HTMLElement | null = null;

function removeChip(): void {
  chip?.remove();
  chip = null;
}

function showChip(x: number, y: number, text: string): void {
  removeChip();
  const host = document.createElement('div');
  // Shadow DOM keeps the chip out of the SPA's React tree so a re-render can't remove it.
  const root = host.attachShadow({ mode: 'open' });
  const btn = document.createElement('button');
  btn.textContent = '🌱 Branch';
  btn.style.cssText =
    'all:unset;cursor:pointer;font:600 12px system-ui;color:#fff;background:#1f6f43;border:1px solid #2e9e60;border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,.4)';
  root.appendChild(btn);
  host.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:2147483647`;
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({
      type: 'SELECTION',
      text,
      conversationId: conversationIdFromUrl(location.href),
    });
    removeChip();
  });
  document.body.appendChild(host);
  chip = host;
}

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel?.toString().trim() ?? '';
  if (!text || text.length < 3) {
    removeChip();
    return;
  }
  const range = sel!.getRangeAt(0).getBoundingClientRect();
  showChip(Math.min(range.right, window.innerWidth - 110), Math.max(range.top - 40, 8), text);
});
document.addEventListener('scroll', removeChip, true);

/* ---------- pending branch prefill on a fresh chat ---------- */

let linkedNodeId: string | null = null;

async function tryPendingPrefill(): Promise<void> {
  const composer = findComposer();
  if (!composer) return;
  const got = await chrome.storage.session.get(PENDING_KEY);
  const pending = got[PENDING_KEY] as PendingBranch | undefined;
  if (!pending) return;
  prefillComposer(pending.text);
  // Only a branch (not a merge) carries a nodeId to link once the new chat gets its real id.
  linkedNodeId = pending.nodeId ?? null;
  await chrome.storage.session.remove(PENDING_KEY);
}

// When a freshly-opened /new chat gets its real conversation id, link it to the draft node so the
// tree knows which claude.ai chat the branch became.
function watchForConversationId(): void {
  let last = location.href;
  const check = () => {
    if (location.href === last) return;
    last = location.href;
    const convId = conversationIdFromUrl(location.href);
    if (convId && linkedNodeId) {
      chrome.runtime.sendMessage({ type: 'LINK_NODE', nodeId: linkedNodeId, conversationId: convId });
      linkedNodeId = null;
    }
  };
  setInterval(check, 800);
}

/* ---------- message handlers from the panel ---------- */

chrome.runtime.onMessage.addListener((msg: PanelToContent | { type: string }, _sender, sendResponse) => {
  const m = msg as PanelToContent;
  if (m.type === 'GET_ACTIVE') {
    const info: ActiveInfo = {
      conversationId: conversationIdFromUrl(location.href),
      url: location.href,
    };
    sendResponse(info);
    return true;
  }
  if (m.type === 'PREFILL') {
    sendResponse(prefillComposer(m.text));
    return true;
  }
  if (m.type === 'GET_TREE') {
    conversationTree(m.conversationId)
      .then((tree) => sendResponse({ ok: true, tree } satisfies TreeResult))
      .catch((err: Error) => sendResponse({ ok: false, reason: err.message } satisfies TreeResult));
    return true; // async
  }
  return undefined;
});

void tryPendingPrefill();
watchForConversationId();
