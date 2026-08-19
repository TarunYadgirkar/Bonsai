/**
 * The MCP Apps garden view: a self-contained HTML document claude.ai renders inline (sandboxed
 * iframe) when bonsai_tree runs. No bundler, no dependencies — the host protocol (SEP-1865) is
 * small enough to speak by hand: ui/initialize → ui/notifications/initialized, then render on
 * every ui/notifications/tool-result (params ARE the CallToolResult; the tree rides in
 * structuredContent). Refresh round-trips tools/call through the host when it advertises
 * serverTools. The inline script deliberately avoids backticks and ${} — it lives in this
 * template literal.
 */
export const TREE_UI_URI = 'ui://bonsai/tree.html';

export const TREE_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Bonsai garden</title>
<style>
  :root {
    --paper: #EEECE3; --paper-raised: #F6F4EC; --ink: #20241E; --ink-soft: #5A5F52;
    --bark: #8A7F6A; --rule: #D8D4C6; --moss: #3E6B47; --moss-bright: #5E8C55;
    --moss-wash: #E3E8DC; --ember: #B65A2E;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px 16px; background: var(--paper); color: var(--ink);
         font: 13px/1.5 system-ui, -apple-system, sans-serif; }
  header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  header h1 { margin: 0; font: 600 16px Georgia, serif; letter-spacing: -0.01em; }
  header .totals { margin-left: auto; font: 11px ui-monospace, Menlo, monospace;
                   color: var(--moss); font-variant-numeric: tabular-nums; text-align: right; }
  header .sub { font-size: 10px; color: var(--bark); letter-spacing: 0.08em; }
  .node { border: 1px solid var(--rule); background: var(--paper-raised); border-radius: 7px;
          padding: 8px 10px; margin: 6px 0; }
  .children { margin-left: 18px; border-left: 1px solid var(--rule); padding-left: 12px; }
  .title { font-weight: 600; }
  .glyph-open { color: var(--moss-bright); } .glyph-merged { color: var(--moss); }
  .glyph-abandoned { color: var(--ink-soft); opacity: 0.7; } .glyph-draft { color: var(--bark); }
  .meta { font: 11px ui-monospace, Menlo, monospace; color: var(--ink-soft); margin-top: 2px;
          font-variant-numeric: tabular-nums; }
  .chip { display: inline-block; font-size: 10px; border: 1px solid var(--rule);
          background: var(--paper); border-radius: 4px; padding: 0 5px; margin-right: 6px; }
  .insight { font-size: 12px; margin-top: 5px; border-top: 1px solid var(--rule); padding-top: 5px; }
  .empty { color: var(--bark); font-size: 12px; padding: 12px 0; }
  footer { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  footer .note { font-size: 10px; color: var(--bark); }
  button { background: var(--moss); color: var(--paper); border: 1px solid var(--moss);
           border-radius: 4px; padding: 4px 10px; font: 600 11px system-ui; cursor: pointer; }
  button:hover { background: var(--moss-bright); }
  button[hidden] { display: none; }
</style>
</head>
<body>
<header>
  <h1>Bonsai</h1><span class="sub">the garden</span>
  <span class="totals" id="totals"></span>
</header>
<div id="tree"><p class="empty">Waiting for the garden…</p></div>
<footer>
  <button id="refresh" hidden>Refresh</button>
  <span class="note">○ open · ✓ merged · ✕ abandoned — one distilled insight returns per merge</span>
</footer>
<script>
(function () {
  'use strict';
  var pending = {};
  var nextId = 1;
  var hostCaps = null;

  function send(msg) { window.parent.postMessage(msg, '*'); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }
  function notify(method, params) {
    var msg = { jsonrpc: '2.0', method: method };
    if (params) msg.params = params;
    send(msg);
  }
  function resize() {
    notify('ui/notifications/size-changed', {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    });
  }

  var GLYPH = { open: '\\u25CB', merged: '\\u2713', abandoned: '\\u2715', draft: '\\u25CC' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nodeHtml(n, childrenHtml) {
    var econ = '';
    if (n.briefTokens != null && n.availableTokens != null) {
      econ = ' ~' + n.availableTokens + '\\u2192' + n.briefTokens + ' tok';
      if (n.prunedPct != null && n.prunedPct > 0) econ += ' \\u00B7 ' + n.prunedPct + '% pruned';
    }
    var chip = n.model ? '<span class="chip">' + esc(n.model) + (n.effort ? ' \\u00B7 ' + esc(n.effort) : '') + '</span>' : '';
    return '<div class="node">' +
      '<div class="title"><span class="glyph-' + esc(n.status) + '">' + (GLYPH[n.status] || '\\u25CB') + '</span> ' + esc(n.title || n.id) + '</div>' +
      '<div class="meta">' + chip + esc(n.status) + econ + '</div>' +
      (n.insight ? '<div class="insight">\\u21B3 ' + esc(n.insight) + '</div>' : '') +
      childrenHtml +
      '</div>';
  }

  function render(data) {
    var nodes = (data && data.nodes) || [];
    var totals = (data && data.totals) || null;
    var byParent = {};
    var ids = {};
    var i, n;
    for (i = 0; i < nodes.length; i++) ids[nodes[i].id] = true;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      var key = n.parentId && ids[n.parentId] ? n.parentId : '';
      (byParent[key] = byParent[key] || []).push(n);
    }
    function subtree(parentKey) {
      var kids = byParent[parentKey] || [];
      var html = '';
      for (var k = 0; k < kids.length; k++) {
        var inner = subtree(kids[k].id);
        html += nodeHtml(kids[k], inner ? '<div class="children">' + inner + '</div>' : '');
      }
      return html;
    }
    var treeEl = document.getElementById('tree');
    treeEl.innerHTML = nodes.length ? subtree('') : '<p class="empty">No branches yet \\u2014 fork a side-question with bonsai_fork.</p>';
    if (totals) {
      document.getElementById('totals').textContent =
        totals.branches + ' branches \\u00B7 ' + totals.merged + ' merged \\u00B7 ' +
        (totals.availableTokens || 0).toLocaleString() + '\\u2192' + (totals.briefTokens || 0).toLocaleString() + ' tok' +
        (totals.prunedPct != null ? ' \\u00B7 ' + totals.prunedPct + '% pruned' : '');
    }
    resize();
  }

  function onToolResult(result) {
    if (result && result.structuredContent) render(result.structuredContent);
  }

  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && (m.result !== undefined || m.error !== undefined) && !m.method) {
      var p = pending[m.id];
      delete pending[m.id];
      if (p) { if (m.error) p.reject(m.error); else p.resolve(m.result); }
      return;
    }
    if (m.method === 'ui/notifications/tool-result') onToolResult(m.params);
    else if (m.method === 'ui/resource-teardown' && m.id != null) {
      send({ jsonrpc: '2.0', id: m.id, result: {} });
    }
  });

  document.getElementById('refresh').addEventListener('click', function () {
    request('tools/call', { name: 'bonsai_tree', arguments: {} }).then(onToolResult, function () {});
  });

  request('ui/initialize', {
    appInfo: { name: 'Bonsai Tree', version: '0.1.0' },
    appCapabilities: {},
    protocolVersion: '2026-01-26'
  }).then(function (res) {
    hostCaps = res && res.hostCapabilities;
    if (hostCaps && hostCaps.serverTools) document.getElementById('refresh').hidden = false;
    notify('ui/notifications/initialized');
    resize();
  }, function () { /* host without MCP Apps: the plain text result still stands */ });
})();
</script>
</body>
</html>`;
