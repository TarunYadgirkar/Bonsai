// src/messages.ts
var PENDING_KEY = "bonsai:pending";
var SELECTION_KEY = "bonsai:selection";

// src/store.ts
var NODES_KEY = "bonsai:nodes";
async function listNodes() {
  const got = await chrome.storage.local.get(NODES_KEY);
  return got[NODES_KEY] ?? [];
}
async function updateNode(id, patch) {
  const nodes = await listNodes();
  await chrome.storage.local.set({
    [NODES_KEY]: nodes.map((n) => n.id === id ? { ...n, ...patch } : n)
  });
}

// src/sw.ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
});
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {
});
chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  if (!tab.url) return;
  const onClaude = new URL(tab.url).origin === "https://claude.ai";
  chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: onClaude }).catch(() => {
  });
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OPEN_PREFILL") {
    const pending = { text: msg.text };
    if (msg.nodeId) pending.nodeId = msg.nodeId;
    chrome.storage.session.set({ [PENDING_KEY]: pending }).then(() => {
      chrome.tabs.create({ url: msg.url || "https://claude.ai/new" });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "SELECTION") {
    const stash = {
      text: msg.text,
      conversationId: msg.conversationId ?? null
    };
    chrome.storage.session.set({ [SELECTION_KEY]: stash }).catch(() => {
    });
    const tabId = _sender.tab?.id;
    if (tabId !== void 0) chrome.sidePanel.open({ tabId }).catch(() => {
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "LINK_NODE") {
    updateNode(msg.nodeId, {
      conversationId: msg.conversationId,
      status: "open"
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return void 0;
});
//# sourceMappingURL=sw.js.map
