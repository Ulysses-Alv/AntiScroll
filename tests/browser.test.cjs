'use strict';
// Requires Playwright and Chromium; no account or live network required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createRequire} = require('node:module');
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'placeholder.cjs')) : require;
const {chromium} = runtimeRequire('playwright');
const extension = path.resolve(__dirname, '../extension');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antiscroll-test-'));
const fixture = `<!doctype html><html><head><style>
body{margin:0;font:16px sans-serif}header{height:70px;background:#ddd}main{margin-left:150px}article{height:500px;border:1px solid #888}aside{position:fixed;left:0;top:80px;width:140px}.nested{height:200px;overflow:auto}.tall{height:1400px}[role=dialog]{position:fixed;right:20px;top:80px;width:250px;height:180px;overflow:auto;background:#ffe}textarea{height:50px}a{display:block}
</style></head><body><header><input id="search" placeholder="Search"></header><aside><a href="/messages">Messages</a><a href="/reels/" id="reels">Reels</a><a href="/i/immersive_media/123" id="videos">Videos</a></aside><main><h1>Content</h1><textarea id="composer"></textarea><div class="nested"><div class="tall">Nested timeline</div></div><article>First post</article><article>Second post</article><article>Third post</article></main><div role="dialog" id="dialog"><div class="tall">Scrollable dialog</div></div></body></html>`;
const errors = [];
let context;
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function waitLocked(page, expected) {
  await page.waitForFunction(value => document.documentElement.hasAttribute('data-antiscroll-locked') === value, expected);
}
async function scrollY(page, value) { await page.evaluate(y => window.scrollTo(0, y), value); await page.waitForTimeout(150); return page.evaluate(() => window.scrollY); }
async function config(worker, patch) {
  await worker.evaluate(async patch => {
    const key = 'antiscrollState'; const current = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({[key]: {...current, ...patch, settings: {...current.settings, ...patch.settings}}});
  }, patch);
}
(async () => {
  try {
    const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    context = await chromium.launchPersistentContext(userDataDir, {channel: 'chromium', executablePath, headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: {width: 1280, height: 850}});
    await context.route(/^https:\/\/(www\.instagram\.com|x\.com|twitter\.com)\//, route => route.fulfill({contentType: 'text/html', body: fixture}));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await worker.evaluate(async () => { while (!(await chrome.storage.local.get('antiscrollState')).antiscrollState) await new Promise(resolve => setTimeout(resolve, 10)); });
    const ig = await context.newPage(); const x = await context.newPage();
    for (const page of [ig, x]) page.on('pageerror', error => errors.push(error.message));
    await ig.goto('https://www.instagram.com/'); await x.goto('https://x.com/home');
    await check('Instagram and X home feeds and nested timelines stay at the top', async () => {
      for (const page of [ig, x]) {
        await waitLocked(page, true);
        assert.equal(await scrollY(page, 700), 0);
        await page.locator('main').hover(); await page.mouse.wheel(0, 650); await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        await page.locator('.nested').evaluate(el => {el.scrollTop = 300;});
        await page.waitForFunction(() => document.querySelector('.nested').scrollTop === 0);
      }
    });
    await check('Search, composing, and scrollable dialogs still work', async () => {
      await ig.locator('#search').fill('Unity VR'); await ig.locator('#search').press('End');
      assert.equal(await ig.locator('#search').inputValue(), 'Unity VR');
      assert.ok(await ig.locator('#dialog').evaluate(el => {el.scrollTop = 200; return el.scrollTop;}) > 0);
      await ig.locator('#composer').fill('Message with spaces');
      assert.equal(await ig.locator('#composer').inputValue(), 'Message with spaces');
    });
    await check('Reels and immersive video links are hidden', async () => {
      assert.equal(await ig.locator('#reels').isVisible(), false);
      assert.equal(await x.locator('#videos').isVisible(), false);
    });
    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('#start').waitFor({state: 'visible'});
    await check('Cancel leaves the pass unused; confirmation starts a shared 15-minute timer', async () => {
      const dialog = popup.getByRole('dialog');
      await popup.locator('#start').click();
      await dialog.waitFor({state: 'visible'});
      assert.match(await dialog.textContent(), /Are you sure you want to use your 15 minutes for today\?/);
      await dialog.getByRole('button', {name: 'Not now'}).click();
      await dialog.waitFor({state: 'hidden'});
      assert.equal(await popup.locator('#statusLabel').textContent(), 'Daily pass available');
      const before = await popup.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).state);
      assert.equal(before.nextAvailableAt, 0);
      await waitLocked(ig, true); await waitLocked(x, true);
      await popup.locator('#start').click();
      const requestedAt = Date.now();
      await dialog.getByRole('button', {name: 'Yes, start the pass'}).click();
      await popup.locator('#stop').waitFor({state: 'visible'});
      const {endAt, nextAvailableAt} = await popup.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).state);
      assert.ok(endAt >= requestedAt + 15 * 60_000 && endAt <= Date.now() + 15 * 60_000);
      assert.equal(nextAvailableAt - endAt, (24 * 60 - 15) * 60_000);
      await waitLocked(ig, false); await waitLocked(x, false);
      assert.ok(await scrollY(ig, 400) > 0); assert.ok(await scrollY(x, 400) > 0);
      await popup.reload(); await popup.locator('#stop').waitFor({state: 'visible'});
      const restarted = await popup.evaluate(() => chrome.runtime.sendMessage({type: 'START_SESSION'}));
      assert.equal(restarted.state.endAt, endAt);
      assert.equal(restarted.state.nextAvailableAt, nextAvailableAt);
      assert.equal(await ig.locator('#reels').isVisible(), false);
    });
    await check('Expiry returns both tabs to the top and leaves the pass on cooldown', async () => {
      await config(worker, {endAt: Date.now() + 600});
      await waitLocked(ig, true); await waitLocked(x, true);
      assert.equal(await ig.evaluate(() => window.scrollY), 0); assert.equal(await x.evaluate(() => window.scrollY), 0);
      await popup.getByText('Daily pass used', {exact: true}).waitFor();
      assert.equal(await popup.locator('#start').isDisabled(), true);
    });
    await check('Messages, stories, and individual posts remain scrollable', async () => {
      for (const url of ['https://www.instagram.com/direct/inbox/', 'https://www.instagram.com/stories/user/123/', 'https://www.instagram.com/p/ABC/']) {await ig.goto(url); await waitLocked(ig, false); assert.ok(await scrollY(ig, 400) > 0);}
      await x.goto('https://x.com/i/chat/1'); await waitLocked(x, false); assert.ok(await scrollY(x, 400) > 0);
    });
    await check('Search scrolling is off by default and opting in does not unlock Explore', async () => {
      await ig.goto('https://www.instagram.com/explore/search/?q=unity'); await x.goto('https://x.com/search?q=unity');
      await waitLocked(ig, true); await waitLocked(x, true);
      await config(worker, {settings: {allowSearchScroll: true}});
      await waitLocked(ig, false); await waitLocked(x, false);
      assert.ok(await scrollY(x, 450) > 0);
      await x.evaluate(() => history.pushState({}, '', '/explore'));
      await waitLocked(x, true); assert.equal(await x.evaluate(() => window.scrollY), 0);
    });
    await check('Direct and SPA navigation to Reels or immersive videos return to the feed', async () => {
      await ig.goto('https://www.instagram.com/reel/ABC/'); await ig.waitForURL('https://www.instagram.com/');
      await x.evaluate(() => history.pushState({}, '', '/i/immersive_media/123'));
      await x.waitForURL('https://x.com/home');
    });
    await check('Stopping early relocks profiles and does not refund the pass', async () => {
      await config(worker, {endAt: 0, nextAvailableAt: Date.now() - 1});
      await popup.locator('#start').click(); await popup.locator('#confirmStart').click();
      await popup.locator('#stop').waitFor({state: 'visible'});
      await popup.locator('#stop').click(); await waitLocked(ig, true); await waitLocked(x, true);
      await popup.reload(); await popup.getByText('Daily pass used', {exact: true}).waitFor();
      assert.equal(await popup.locator('#start').isDisabled(), true);
      assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({type: 'START_SESSION'}))).ok, false);
      await ig.goto('https://www.instagram.com/persona/'); await waitLocked(ig, true);
      await x.goto('https://x.com/persona'); await waitLocked(x, true);
    });
    await check('Disabling one network restores its scroll and never redirects its direct Reels URL', async () => {
      await config(worker, {settings: {instagram: false}}); await waitLocked(ig, false);
      assert.ok(await scrollY(ig, 400) > 0); assert.equal(await ig.locator('#reels').isVisible(), true);
      await waitLocked(x, true);
      const reelUrl = 'https://www.instagram.com/reel/ABC/';
      await ig.goto(reelUrl);
      await ig.locator('[data-antiscroll-ui]').waitFor({state: 'attached'});
      assert.equal(ig.url(), reelUrl);
    });
    assert.deepEqual(errors, []);
    console.log(`${passed} browser scenarios passed; no page errors.`);
  } finally { await context?.close(); fs.rmSync(userDataDir, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
