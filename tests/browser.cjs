const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extensionPath = process.env.XFC_EXTENSION_PATH || path.resolve(__dirname, '..');
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

    // Model an advertiser whose visible @handle is shortened after a badge
    // changes the available space. A brand link is not the tweet author.
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.dataset.testid = 'User-Name'; host.id = 'advertiser';
      host.style.cssText = 'width:260px;display:flex;flex-wrap:wrap';
      host.innerHTML = '<a href="/Brand"><span>G</span></a>' +
        '<a class="author" href="/Carol"><div style="display:flex;flex-direction:row"><span>Long advertiser display name</span></div></a>' +
        '<a class="handle" href="/Carol"><span>@Carol</span></a>';
      document.querySelector('main').append(host);
      window.__advertiserChanges = 0;
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if ([...record.addedNodes, ...record.removedNodes].some(n => n.matches?.('.xfc-badge'))) window.__advertiserChanges++;
        }
        const text = host.querySelector('a.handle span');
        const expected = host.querySelector('.xfc-badge') ? '@Ca...' : '@Carol';
        if (text.textContent !== expected) text.textContent = expected;
      });
      observer.observe(host, { childList: true, subtree: true });
      window.__advertiserObserver = observer;
    });
    await page.waitForFunction(() => document.querySelector('#advertiser .xfc-badge')?.dataset.handle === 'carol');
    const stability = await page.evaluate(async () => {
      const positions = [];
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const badge = document.querySelector('#advertiser .xfc-badge');
        positions.push(badge ? [badge.dataset.handle, badge.parentElement.parentElement.className,
          document.querySelector('#advertiser').getBoundingClientRect().height] : null);
      }
      window.__advertiserObserver.disconnect();
      return { positions, changes: window.__advertiserChanges };
    });
    assert.ok(stability.positions.every(p => p && p[0] === 'carol' && p[1] === 'author'), JSON.stringify(stability));
    assert.equal(new Set(stability.positions.map(JSON.stringify)).size, 1, 'stable height and position');
    assert.equal(stability.changes, 1, 'badge mounts once without disappearing');
    passed.push('truncated advertiser handle, brand-link ownership, stable badge and row height');

    // Adding an X name decoration must not move an existing follower badge.
    const decorationWrites = await page.evaluate(async () => {
      const row = document.querySelector('#carol a:first-child > div');
      const badge = row.querySelector('.xfc-badge');
      const decoration = document.createElement('span'); decoration.textContent = '★'; row.append(decoration);
      let writes = 0;
      const observer = new MutationObserver(records => {
        writes += records.filter(r => [...r.addedNodes, ...r.removedNodes].includes(badge)).length;
      });
      observer.observe(row, { childList: true });
      for (let i = 0; i < 5; i++) {
        window.postMessage({ channel: 'x-follower-count:v1', type: 'users', users: [{ handle: 'Carol', followers: 26000 }] }, location.origin);
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      observer.disconnect(); decoration.remove(); return writes;
    });
    assert.equal(decorationWrites, 0, 'unchanged data does not move the badge');

    // A second page-world injection must retire the older renderer, including
    // the original extension's isolated-world instance.
    const firstRenderer = await page.evaluate(() => document.documentElement.dataset.xfcRenderer);
    await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'core.js'), 'utf8') });
    for (let i = 0; i < 2; i++) await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'content.js'), 'utf8') });
    await page.waitForFunction(previous => document.documentElement.dataset.xfcRenderer &&
      document.documentElement.dataset.xfcRenderer !== previous && document.querySelector('#advertiser .xfc-badge')?.dataset.handle === 'carol', firstRenderer);
    await page.waitForFunction(() => document.querySelectorAll('#advertiser .xfc-badge').length === 1);
    passed.push('name decorations and repeated injection do not move or duplicate badges');

    await page.evaluate(() => { document.getElementById('dynamic').remove(); document.getElementById('advertiser').remove(); });
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
