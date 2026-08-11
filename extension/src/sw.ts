/**
 * Service worker — panel scoping and the small amount of cross-context routing the panel needs
 * (opening a new claude.ai chat tab, linking a branch node to the chat it became). No claude.ai
 * data is fetched here: reads happen in the content script, on the page, same-origin.
 */
import { PENDING_KEY, type PendingBranch } from './messages';
import { updateNode } from './store';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// session storage defaults to TRUSTED_CONTEXTS only, so the content script (an untrusted context)
// cannot read the pending-branch hand-off — the prefill would silently no-op. Open it to both.
chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch(() => {});

chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  if (!tab.url) return;
  const onClaude = new URL(tab.url).origin === 'https://claude.ai';
  chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: onClaude }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg: { type: string; [k: string]: unknown }, _sender, sendResponse) => {
  // Open a claude.ai chat (a fresh /new for a branch, or an existing chat for a merge) and stash
  // the text for the content script to pre-fill. The user reviews and sends — we never send.
  if (msg.type === 'OPEN_PREFILL') {
    const pending: PendingBranch = { text: msg.text as string };
    if (msg.nodeId) pending.nodeId = msg.nodeId as string;
    chrome.storage.session.set({ [PENDING_KEY]: pending }).then(() => {
      chrome.tabs.create({ url: (msg.url as string) || 'https://claude.ai/new' });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'LINK_NODE') {
    updateNode(msg.nodeId as string, {
      conversationId: msg.conversationId as string,
      status: 'open',
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});
