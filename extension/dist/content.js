"use strict";
(() => {
  // src/claude-api.ts
  var ALLOWED_PATH = /^\/api\/organizations(\/|$)/;
  async function get(path) {
    if (!ALLOWED_PATH.test(path)) throw new Error(`bonsai: blocked non-read path ${path}`);
    const res = await fetch(`https://claude.ai${path}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`claude.ai ${res.status} on ${path}`);
    return await res.json();
  }
  async function orgId() {
    const cookie = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];
    if (cookie) return decodeURIComponent(cookie);
    const orgs = await get("/api/organizations");
    const id = orgs[0]?.uuid;
    if (!id) throw new Error("bonsai: no organization found");
    return id;
  }
  function textOf(m) {
    if (m.content?.length) {
      return m.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();
    }
    return (m.text ?? "").trim();
  }
  function reconstructPath(raw) {
    const byId = new Map((raw.chat_messages ?? []).map((m) => [m.uuid, m]));
    const path = [];
    let cursor = raw.current_leaf_message_uuid ? byId.get(raw.current_leaf_message_uuid) : void 0;
    if (!cursor) {
      for (const m of raw.chat_messages ?? []) {
        path.push({ uuid: m.uuid, role: m.sender === "human" ? "user" : "assistant", text: textOf(m) });
      }
      return { uuid: raw.uuid, name: raw.name, path: path.filter((t) => t.text) };
    }
    while (cursor) {
      path.push({
        uuid: cursor.uuid,
        role: cursor.sender === "human" ? "user" : "assistant",
        text: textOf(cursor)
      });
      cursor = cursor.parent_message_uuid ? byId.get(cursor.parent_message_uuid) : void 0;
    }
    return { uuid: raw.uuid, name: raw.name, path: path.reverse().filter((t) => t.text) };
  }
  async function conversationTree(conversationId) {
    const org = await orgId();
    const raw = await get(
      `/api/organizations/${org}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`
    );
    return reconstructPath(raw);
  }
  function conversationIdFromUrl(url) {
    return /\/chat\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null;
  }

  // src/messages.ts
  var PENDING_KEY = "bonsai:pending";

  // src/content.ts
  var COMPOSER_SELECTORS = [
    '[aria-label="Write your prompt to Claude"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].ProseMirror'
  ];
  function findComposer() {
    for (const sel of COMPOSER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  function prefillComposer(text) {
    const el = findComposer();
    if (!el) return { ok: false, reason: "composer not found" };
    el.focus();
    if (document.execCommand("insertText", false, text) && el.textContent?.includes(text)) {
      return { ok: true };
    }
    const frag = document.createDocumentFragment();
    for (const line of text.split("\n")) {
      const p = document.createElement("p");
      p.textContent = line;
      frag.appendChild(p);
    }
    el.replaceChildren(frag);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: el.textContent?.includes(text.split("\n")[0]) ?? false };
  }
  var chip = null;
  function removeChip() {
    chip?.remove();
    chip = null;
  }
  function showChip(x, y, text) {
    removeChip();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.textContent = "\u{1F331} Branch";
    btn.style.cssText = "all:unset;cursor:pointer;font:600 12px system-ui;color:#fff;background:#1f6f43;border:1px solid #2e9e60;border-radius:8px;padding:6px 10px;box-shadow:0 4px 12px rgba(0,0,0,.4)";
    root.appendChild(btn);
    host.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:2147483647`;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({
        type: "SELECTION",
        text,
        conversationId: conversationIdFromUrl(location.href)
      });
      removeChip();
    });
    document.body.appendChild(host);
    chip = host;
  }
  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || text.length < 3) {
      removeChip();
      return;
    }
    const range = sel.getRangeAt(0).getBoundingClientRect();
    showChip(Math.min(range.right, window.innerWidth - 110), Math.max(range.top - 40, 8), text);
  });
  document.addEventListener("scroll", removeChip, true);
  var linkedNodeId = null;
  async function tryPendingPrefill() {
    const composer = findComposer();
    if (!composer) return;
    const got = await chrome.storage.session.get(PENDING_KEY);
    const pending = got[PENDING_KEY];
    if (!pending) return;
    prefillComposer(pending.text);
    linkedNodeId = pending.nodeId ?? null;
    await chrome.storage.session.remove(PENDING_KEY);
  }
  function watchForConversationId() {
    let last = location.href;
    const check = () => {
      if (location.href === last) return;
      last = location.href;
      const convId = conversationIdFromUrl(location.href);
      if (convId && linkedNodeId) {
        chrome.runtime.sendMessage({ type: "LINK_NODE", nodeId: linkedNodeId, conversationId: convId });
        linkedNodeId = null;
      }
    };
    setInterval(check, 800);
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const m = msg;
    if (m.type === "GET_ACTIVE") {
      const info = {
        conversationId: conversationIdFromUrl(location.href),
        url: location.href
      };
      sendResponse(info);
      return true;
    }
    if (m.type === "PREFILL") {
      sendResponse(prefillComposer(m.text));
      return true;
    }
    if (m.type === "GET_TREE") {
      conversationTree(m.conversationId).then((tree) => sendResponse({ ok: true, tree })).catch((err) => sendResponse({ ok: false, reason: err.message }));
      return true;
    }
    return void 0;
  });
  void tryPendingPrefill();
  watchForConversationId();
})();
//# sourceMappingURL=content.js.map
