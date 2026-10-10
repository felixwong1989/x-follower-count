const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extensionPath = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xfc-test-'));

(async () => {
  let context;
  const passed = [];
  const apiRequests = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chromium',
      ignoreDefaultArgs: ['--disable-extensions'],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      viewport: { width: 1000, height: 950 },
      args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath]
    });
    let mode = 'normal';
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/graphql/')) {
        apiRequests.push(url.pathname);
        if (url.pathname.endsWith('/Failure')) return route.abort();
        const payload = url.pathname.endsWith('/NotJson') ? 'not JSON' : JSON.stringify({ data: { users: [
          { core: { screen_name: 'Bob' }, relationship_counts: { followers: 0, following: 100 } },
          { legacy: { screen_name: 'Carol', followers_count: mode === 'update' ? 26000 : 25000 } },
          { legacy: { screen_name: 'Dave', followers_count: 9999 } }
        ] } });
        return route.fulfill({ contentType: 'application/json', body: payload });
      }
      if (url.hostname === 'x.com') return route.fulfill({ contentType: 'text/html', body: fixture });
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://x.com/Alice/following');
    try {
      await page.waitForFunction(() => document.querySelector('#alice .xfc-badge')?.textContent === '粉丝 1.2万', null, { timeout: 10000 });
    } catch (error) {
      console.error('Startup diagnostics:', await page.evaluate(() => ({
        hookInstalled: !!window.__xFollowerNetworkInstalled,
        coreInstalled: !!window.XFollowerCore,
        statePresent: !!window.__INITIAL_STATE__,
        badges: document.querySelectorAll('.xfc-badge').length,
        body: document.body.innerText.slice(0, 500)
      })), errors);
      throw error;
    }
    passed.push('actual manifest injection, MAIN-to-ISOLATED bridge, initial state');

    const body = await page.evaluate(async () => {
      const response = await fetch('/i/api/graphql/fixture/Following');
      return response.json();
    });
    assert.equal(body.data.users[0].relationship_counts.followers, 0);
    await page.waitForFunction(() => document.querySelector('#bob .xfc-badge')?.textContent === '粉丝 0');
    await page.waitForFunction(() => document.querySelector('#carol .xfc-badge')?.textContent === '粉丝 2.5万');
    assert.equal(await page.locator('#unknown .xfc-badge').count(), 0);
    assert.equal(await page.locator('#quote .xfc-badge').count(), 1);
    assert.equal(await page.locator('#carol a:first-child > div > .xfc-badge:last-child').count(), 1);
    assert.equal(await page.locator('#alice a.name + .xfc-badge').count(), 1);
    passed.push('fetch interception preserves response; user list, zero, timeline, quote, missing data');

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'dynamic'; host.dataset.testid = 'UserCell';
      host.innerHTML = '<a href="/Dave"><span>@Dave</span></a>';
      document.querySelector('main').append(host);
    });
    await page.waitForFunction(() => document.querySelector('#dynamic .xfc-badge')?.textContent === '粉丝 9,999');
    await page.evaluate(() => {
      const link = document.querySelector('#dynamic a');
      link.href = '/Bob'; link.querySelector('span').textContent = '@Bob';
      history.pushState(null, '', '/Alice/followers');
    });
    await page.waitForFunction(() => document.querySelector('#dynamic .xfc-badge')?.dataset.handle === 'bob');
    assert.equal(await page.locator('#dynamic .xfc-badge').count(), 1);
    assert.equal(await page.locator('#dynamic .xfc-badge').textContent(), '粉丝 0');
    passed.push('infinite scroll, virtualized row reuse, SPA navigation, no duplicate badges');

    mode = 'update';
    const xhrBody = await page.evaluate(() => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/i/api/graphql/fixture/Followers');
      xhr.responseType = 'json';
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = reject;
      xhr.send();
    }));
    assert.equal(xhrBody.data.users[1].legacy.followers_count, 26000);
    await page.waitForFunction(() => document.querySelector('#carol .xfc-badge')?.textContent === '粉丝 2.6万');
    passed.push('XMLHttpRequest JSON path and count updates');
    const textBody = await page.evaluate(() => new Promise(resolve => {
      const xhr = new XMLHttpRequest(); xhr.open('GET', '/i/api/graphql/fixture/Text');
      xhr.onload = () => resolve(JSON.parse(xhr.responseText)); xhr.send();
    }));
    assert.equal(textBody.data.users.length, 3);
    const notJson = await page.evaluate(async () => (await fetch('/i/api/graphql/fixture/NotJson')).text());
    assert.equal(notJson, 'not JSON');
    const failed = await page.evaluate(async () => { try { await fetch('/i/api/graphql/fixture/Failure'); return false; } catch { return true; } });
    assert.equal(failed, true);
    assert.equal(apiRequests.length, 5);
    passed.push('XHR text, non-JSON and network errors preserve page behavior; no added API calls');

    await page.evaluate(() => document.getElementById('dynamic').remove());
    await page.screenshot({ path: path.join(extensionPath, 'demo.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const report = { passed: passed.length, checks: passed, browser: context.browser()?.version(), mode: 'Headless Chromium, actual unpacked extension, mock X responses (not live X)', liveXVerified: false };
    fs.writeFileSync(path.join(extensionPath, 'TEST-RESULTS.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (context) await context.close();
    // profile is a fresh task-owned temporary directory with a fixed prefix.
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('xfc-test-')) fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
