// Streamable-HTTP smoke for the MCP connector. Run: node app/api/mcp/smoke.mjs
// against `npx next dev -p 3220`. Not a route file; Next ignores non-route files here.

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3220/api/mcp/bonsai-dev-key';
const BAD = BASE.replace(/[^/]+$/, 'not-a-real-key');

let rpcId = 0;
let protocolVersion = '2025-06-18';
let sessionId = null;
const failures = [];

function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  if (!ok) failures.push(name);
}

function parseBody(contentType, raw) {
  if (contentType.includes('text/event-stream')) {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    return data.length > 0 ? JSON.parse(data[data.length - 1]) : null;
  }
  return raw ? JSON.parse(raw) : null;
}

async function post(url, body) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': protocolVersion,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await res.text();
  let json = null;
  try {
    json = parseBody(res.headers.get('content-type') ?? '', raw);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, raw };
}

async function rpc(method, params) {
  rpcId += 1;
  return post(BASE, { jsonrpc: '2.0', id: rpcId, method, params });
}

function toolText(json) {
  return json?.result?.content?.map((c) => c.text).join('\n') ?? '';
}

async function main() {
  const init = await rpc('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'bonsai-smoke', version: '0.0.1' },
  });
  check('initialize 200', init.status === 200, `status ${init.status}`);
  check('initialize serverInfo', init.json?.result?.serverInfo?.name === 'bonsai');
  if (init.json?.result?.protocolVersion) protocolVersion = init.json.result.protocolVersion;
  sessionId = init.headers.get('mcp-session-id');

  const initialized = await post(BASE, { jsonrpc: '2.0', method: 'notifications/initialized' });
  check('initialized notification accepted', [200, 202, 204].includes(initialized.status), `status ${initialized.status}`);

  const list = await rpc('tools/list', {});
  const toolNames = (list.json?.result?.tools ?? []).map((t) => t.name).sort();
  check('tools/list 200', list.status === 200, `status ${list.status}`);
  check(
    'tools/list has 4 bonsai tools',
    JSON.stringify(toolNames) === JSON.stringify(['bonsai_abandon', 'bonsai_fork', 'bonsai_merge', 'bonsai_tree']),
    toolNames.join(','),
  );
  console.log('tools/list:', JSON.stringify(list.json?.result?.tools?.map((t) => ({ name: t.name, annotations: t.annotations })), null, 1));

  const fork = await rpc('tools/call', {
    name: 'bonsai_fork',
    arguments: {
      question: 'What date does the QA freeze start, given the September release?',
      brief:
        'Project Bonsai targets a September release. The release owner is Tarun. ' +
        'QA freeze length is one week and ends the day before the ship date.',
      facts: ['Ship date: September 12', 'QA freeze lasts 7 days', 'Release owner: Tarun'],
      excludedNote: 'Full release checklist and unrelated auth-refactor discussion.',
      model: 'haiku',
      effort: 'low',
      availableTokensEstimate: 12000,
    },
  });
  const forkText = toolText(fork.json);
  const branchId = forkText.match(/branchId: ([0-9a-f-]{36})/)?.[1] ?? null;
  check('bonsai_fork 200', fork.status === 200, `status ${fork.status}`);
  check('bonsai_fork not isError', !fork.json?.result?.isError);
  check('bonsai_fork returns branchId', Boolean(branchId), branchId ?? 'none');
  check('bonsai_fork routing line', forkText.includes('Routing: haiku · low'));
  check('bonsai_fork economics', /12,000 → \d+ tokens · [\d.]+% pruned/.test(forkText));
  check('bonsai_fork paste block', forkText.includes('Paste everything between the rules'));

  const tree = await rpc('tools/call', { name: 'bonsai_tree', arguments: {} });
  const treeText = toolText(tree.json);
  const structured = tree.json?.result?.structuredContent;
  check('bonsai_tree 200', tree.status === 200, `status ${tree.status}`);
  check('bonsai_tree shows branch', treeText.includes('QA freeze'));
  check('bonsai_tree structuredContent', (structured?.nodes?.length ?? 0) >= 1 && structured?.totals?.branches >= 1);
  console.log('bonsai_tree text:\n' + treeText);

  const merge = await rpc('tools/call', {
    name: 'bonsai_merge',
    arguments: { branchId, insight: '"QA freeze starts September 5 — seven days before the September 12 ship date."' },
  });
  const mergeText = toolText(merge.json);
  check('bonsai_merge 200', merge.status === 200, `status ${merge.status}`);
  check('bonsai_merge confirms', mergeText.startsWith('Merged'), mergeText.split('\n')[0]);
  check('bonsai_merge tree summary', /Tree: \d+ branches · \d+ open · \d+ merged/.test(mergeText));

  const overlong = await rpc('tools/call', {
    name: 'bonsai_merge',
    arguments: { branchId, insight: Array(40).fill('word').join(' ') },
  });
  check('bonsai_merge rejects >30 words', overlong.json?.result?.isError === true);

  const probe = await post(BAD, {
    jsonrpc: '2.0',
    id: 999,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 's', version: '0' } },
  });
  check('unknown key → 401', probe.status === 401, `status ${probe.status}`);

  console.log(failures.length === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
