/**
 * E2E for the side panel's own buttons — the "last mile" test-e2e.mjs can't reach when the
 * panel is docked as browser chrome. Here sidepanel.html runs as a regular extension tab
 * (same document, same scripts, same chrome.* APIs), a claude.ai chat fixture rides in the
 * active tab beside it, and claude.ai's read API is fulfilled locally. Proves:
 *
 *   1. Compile reads the active chat through the content script and renders a brief preview
 *      with facts, economics, and a routing pick.
 *   2. "Open branch chat →" stores a draft node and opens claude.ai/new with the brief
 *      prefilled into the composer (through the SW pending-key path).
 *   3. "⤴ Merge to parent" marks the node merged and opens the parent chat with the
 *      one-insight merge prompt prefilled.
 *   4. The never-send invariant holds across every panel-driven flow (no non-GET requests).
 *
 * Run: npm run test:e2e:panel
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EXT = dirname(fileURLToPath(import.meta.url));
const SHOT = (name) => join(EXT, '..', 'assets', 'generated', name);
const ORG = '99999999-aaaa-4bbb-8ccc-000000000001';
const CHAT = '123e4567-e89b-42d3-a456-426614174000';
const NEW_CHAT_URL = 'https://claude.ai/new';

const RAW_CONVERSATION = {
  uuid: CHAT,
  name: 'Berkeley fiscal report',
  current_leaf_message_uuid: 'm2',
  chat_messages: [
    {
      uuid: 'm1',
      parent_message_uuid: null,
      sender: 'human',
      content: [{ type: 'text', text: 'Summarize the Berkeley fiscal report for me.' }],
    },
    {
      uuid: 'm2',
      parent_message_uuid: 'm1',
      sender: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The report shows a structural deficit driven mostly by pension obligations, with declining enrollment reducing per-student funding across the district.',
        },
      ],
    },
  ],
};

const FIXTURE = `<!doctype html><html><head><title>Claude</title></head><body>
<main>
  <p>structural deficit driven mostly by pension obligations</p>
  <div class="ProseMirror" contenteditable="true" aria-label="Write your prompt to Claude"><p><br></p></div>
</main>
</body></html>`;

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
}

const posts = [];

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: process.env.HEADED !== '1',
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    // Hermetic: a tab the SW opens navigates before context.route can attach — pin claude.ai
    // to localhost so that first request can never reach the real site; the routed re-goto
    // below then serves the fixture.
    '--host-resolver-rules=MAP claude.ai 127.0.0.1,MAP *.claude.ai 127.0.0.1',
  ],
});

try {
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    // The panel's own document and scripts load from chrome-extension:// — never intercept.
    if (url.startsWith('chrome-extension://')) return route.continue();
    if (req.method() !== 'GET') posts.push(`${req.method()} ${url}`);
    if (url.startsWith('https://claude.ai/api/organizations')) {
      const body = url.includes(`/chat_conversations/${CHAT}`)
        ? RAW_CONVERSATION
        : url.endsWith('/chat_conversations')
          ? [{ uuid: CHAT, name: RAW_CONVERSATION.name, updated_at: new Date().toISOString() }]
          : [{ uuid: ORG }];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (url.startsWith('https://claude.ai/') && req.resourceType() === 'document') {
      return route.fulfill({ contentType: 'text/html', body: FIXTURE });
    }
    return route.abort();
  });

  const sw =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() =>
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }),
  );

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 720 });
  panel.on('console', (m) => console.log('panel-console:', m.type(), m.text().slice(0, 200)));
  panel.on('pageerror', (e) => console.log('panel-error:', String(e).slice(0, 300)));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

  // The chat tab opens second so tabs.query({active: true}) resolves to IT, not the panel —
  // the same relationship a docked panel has with the page beside it.
  const chat = await context.newPage();
  await chat.goto(`https://claude.ai/chat/${CHAT}`);
  await chat.bringToFront();

  // 1. Compile.
  await panel.fill('#selection', 'pension obligations');
  await panel.fill('#question', 'What share of the deficit is pensions alone?');
  await panel.click('#compile');
  await panel.waitForTimeout(2500);
  console.log('status:', JSON.stringify(await panel.locator('#compile-status').innerText()));
  console.log('preview html:', (await panel.locator('#preview').innerHTML()).slice(0, 200));
  await panel.waitForSelector('.brief', { timeout: 10000 });
  const facts = await panel.locator('.brief li').count();
  const econ = await panel.locator('.econ').first().innerText();
  check('compile renders a brief preview', facts > 0, `facts=${facts}`);
  check('economics line present', /tok (available|thread)/.test(econ), econ);
  check('routing pick rendered', (await panel.locator('select option').count()) === 3);
  await panel.screenshot({ path: SHOT('panel-compiled.png'), fullPage: true });

  // 2. Open branch chat → new tab prefilled through the SW pending path.
  const [branchPage] = await Promise.all([
    context.waitForEvent('page'),
    panel.getByRole('button', { name: /Open branch chat/ }).click(),
  ]);
  await branchPage.waitForLoadState('domcontentloaded').catch(() => {});
  // The SW's tabs.create navigation raced ahead of routing (and was blackholed by the resolver
  // rule); re-navigate under interception so the fixture + content script load.
  await branchPage.goto(NEW_CHAT_URL).catch(() => {});
  await branchPage.waitForSelector('.ProseMirror', { timeout: 10000 });
  await branchPage
    .waitForFunction(
      () => (document.querySelector('.ProseMirror')?.textContent ?? '').length > 50,
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  const prefilled = await branchPage.evaluate(
    () => document.querySelector('.ProseMirror')?.textContent ?? '',
  );
  check(
    'branch chat composer prefilled with the compiled brief',
    /compiled brief|brief/i.test(prefilled) && prefilled.includes('pension'),
    prefilled.slice(0, 120),
  );
  check('brief carries the side question', prefilled.includes('pensions alone'));

  // 3. The tree shows the draft; merge it back.
  await panel.bringToFront();
  await panel.waitForSelector('.node', { timeout: 5000 });
  await panel.fill('.node textarea', 'Pensions alone are roughly two-thirds of the deficit.');
  const [mergePage] = await Promise.all([
    context.waitForEvent('page'),
    panel.getByRole('button', { name: /Merge to parent/ }).click(),
  ]);
  await mergePage.waitForLoadState('domcontentloaded').catch(() => {});
  await mergePage.goto(`https://claude.ai/chat/${CHAT}`).catch(() => {});
  await mergePage.waitForSelector('.ProseMirror', { timeout: 10000 });
  await mergePage
    .waitForFunction(
      () => document.querySelector('.ProseMirror')?.textContent?.includes('two-thirds'),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  const mergeText = await mergePage.evaluate(
    () => document.querySelector('.ProseMirror')?.textContent ?? '',
  );
  check('parent chat prefilled with the merge insight', mergeText.includes('two-thirds'));
  const merged = await panel.locator('.glyph-merged').count();
  check('node shows as merged in the tree', merged > 0);
  await panel.screenshot({ path: SHOT('panel-merged.png'), fullPage: true });

  // 4. Never-send, panel edition.
  check('never-send held for the entire panel run', posts.length === 0, posts.join(', '));
} finally {
  await context.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall panel e2e checks passed');
process.exit(failures ? 1 : 0);
