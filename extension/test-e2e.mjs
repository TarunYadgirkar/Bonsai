/**
 * E2E harness for the extension's load-bearing promises, runnable entirely locally:
 *
 *   1. A pending branch seeded into chrome.storage.session prefills the composer on the next
 *      claude.ai page — and the pending key is consumed.
 *   2. NOTHING sends: zero POST requests fire during the whole run (the structural never-send,
 *      observed at the network layer rather than inferred from the bundle).
 *   3. When the fresh chat gains a real conversation id, LINK_NODE binds the draft node to it.
 *   4. Selecting page text shows the Branch chip; clicking it clears selection + dismisses.
 *
 * claude.ai is never actually reached: every request is intercepted and the document is a local
 * fixture with a ProseMirror-shaped composer, so the run needs no login and risks no account.
 * The only thing this cannot cover is the literal side-panel button clicks (chrome.sidePanel is
 * not page-addressable) — that last mile stays human / Cowork, per PLAN.md.
 *
 * Run: npm run test:e2e   (builds dist/ first; needs `npx playwright install chromium` once)
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const EXT = dirname(fileURLToPath(import.meta.url));
const NEW_CHAT_URL = 'https://claude.ai/new';
const CHAT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PENDING_KEY = 'bonsai:pending';
const NODES_KEY = 'bonsai:nodes';

const BRIEF = [
  '**Branch context (compiled by Bonsai)**',
  'Parent asked about Berkeley fiscal report; deficit driven by pension obligations.',
  'Question: what share of the deficit is pensions alone?',
].join('\n');

const DRAFT_NODE = {
  id: 'n1',
  conversationId: null,
  parentConversationId: 'aaaaaaaa-0000-0000-0000-000000000000',
  title: 'pension share',
  selection: 'pension obligations',
  question: 'what share of the deficit is pensions alone?',
  briefMarkdown: BRIEF,
  facts: [],
  excludedNote: '',
  availableTokens: 1000,
  briefTokens: 60,
  prunedPct: 94,
  tier: 'small',
  model: 'claude-haiku-4-5-20251001',
  modelLabel: 'Haiku',
  effort: 'low',
  status: 'draft',
  insight: null,
  createdAt: new Date().toISOString(),
};

const FIXTURE = `<!doctype html><html><head><title>Claude</title></head><body>
<main>
  <p id="prose">Berkeley's fiscal report shows a deficit driven by pension obligations and declining enrollment across the district.</p>
  <div class="ProseMirror" contenteditable="true" aria-label="Write your prompt to Claude"><p><br></p></div>
</main>
</body></html>`;

let failures = 0;
function check(name, cond, detail = '') {
  const mark = cond ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

const posts = [];
const sends = [];

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', // full Chromium: extensions load under the new headless, unlike the shell
  headless: process.env.HEADED !== '1',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  // Record inside the route handler, not a 'request' listener — the handler is guaranteed to see
  // every request (including ones it aborts), so the never-send assertions cannot pass vacuously.
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() !== 'GET') posts.push(`${req.method()} ${url}`);
    if (/completion|append_message|retry/.test(url)) sends.push(url);
    if (url.startsWith('https://claude.ai/') && req.resourceType() === 'document') {
      return route.fulfill({ contentType: 'text/html', body: FIXTURE });
    }
    return route.abort();
  });

  const sw =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));

  await sw.evaluate(
    async ({ pendingKey, nodesKey, pending, nodes }) => {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
      await chrome.storage.session.set({ [pendingKey]: pending });
      await chrome.storage.local.set({ [nodesKey]: nodes });
    },
    {
      pendingKey: PENDING_KEY,
      nodesKey: NODES_KEY,
      pending: { nodeId: DRAFT_NODE.id, text: BRIEF },
      nodes: [DRAFT_NODE],
    },
  );

  const page = await context.newPage();
  await page.goto(NEW_CHAT_URL, { waitUntil: 'domcontentloaded' });

  /* 1 — prefill */
  const firstLine = BRIEF.split('\n')[0];
  const lastLine = BRIEF.split('\n').at(-1);
  const prefilled = await page
    .waitForFunction(
      (line) => document.querySelector('.ProseMirror')?.textContent?.includes(line),
      firstLine,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  check('composer prefilled with brief', prefilled);
  const composerText = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '');
  check('brief survives to the last line', composerText.includes(lastLine));

  const pendingAfter = await sw.evaluate(
    async (key) => (await chrome.storage.session.get(key))[key] ?? null,
    PENDING_KEY,
  );
  check('pending key consumed after prefill', pendingAfter === null);

  /* 2 — never-send: grace period, then the network log must show zero non-GETs */
  await page.waitForTimeout(1500);
  check('still on /new after prefill (nothing navigated)', page.url() === NEW_CHAT_URL);
  check('zero POST/PUT/DELETE requests', posts.length === 0, posts.join(', '));
  check('zero completion-shaped requests', sends.length === 0, sends.join(', '));

  /* 3 — LINK_NODE once the fresh chat gains a real conversation id */
  await page.evaluate((uuid) => history.pushState({}, '', `/chat/${uuid}`), CHAT_UUID);
  const linked = await sw
    .evaluate(
      async ({ nodesKey, uuid }) => {
        for (let i = 0; i < 25; i++) {
          const nodes = (await chrome.storage.local.get(nodesKey))[nodesKey] ?? [];
          const n = nodes.find((x) => x.id === 'n1');
          if (n?.conversationId === uuid && n.status === 'open') return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      },
      { nodesKey: NODES_KEY, uuid: CHAT_UUID },
    )
    .catch(() => false);
  check('draft node linked to the new conversation (LINK_NODE)', linked);

  /* 4 — Branch chip on selection */
  await page.evaluate(() => {
    const p = document.getElementById('prose');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('mouseup', { bubbles: true }));
  });
  const chipShown = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('div')].some(
          (d) => d.shadowRoot?.textContent?.includes('Branch') && d.style.zIndex === '2147483647',
        ),
      { timeout: 3000 },
    )
    .then(() => true)
    .catch(() => false);
  check('Branch chip appears on selection', chipShown);

  if (chipShown) {
    await page.evaluate(() => {
      const host = [...document.querySelectorAll('div')].find((d) =>
        d.shadowRoot?.textContent?.includes('Branch'),
      );
      host.shadowRoot
        .querySelector('button')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    const chipGone = await page
      .waitForFunction(
        () => ![...document.querySelectorAll('div')].some((d) => d.shadowRoot?.textContent?.includes('Branch')),
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    check('chip dismisses on click', chipGone);
    check('selection cleared on chip click', await page.evaluate(() => getSelection().toString() === ''));
  }

  /* final network sweep — the whole session, all contexts */
  check('never-send held for the entire run', posts.length === 0 && sends.length === 0);

  /* canary — prove the harness would actually catch a send. A deliberate POST from the page must
   * land in the log; without this, the zero-POST checks could pass because detection is broken. */
  await page.evaluate(() =>
    fetch('https://claude.ai/api/canary_completion', { method: 'POST', body: '{}' }).catch(() => {}),
  );
  await page.waitForTimeout(300);
  check('canary POST detected (harness is not vacuous)', posts.some((p) => p.includes('canary')));
  check('canary flagged as completion-shaped', sends.some((u) => u.includes('canary')));
} finally {
  await context.close();
}

console.log(failures === 0 ? '\nall e2e checks passed' : `\n${failures} e2e check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
