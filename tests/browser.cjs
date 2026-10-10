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
      await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=alice]')?.textContent === '1.2万', null, { timeout: 10000 });
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
    await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=bob]')?.textContent === '0');
    await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=carol]')?.textContent === '2.5万');
    assert.equal(await page.locator('.xfc-badge[data-handle=unknown]').count(), 0);
    assert.equal(await page.locator('.xfc-badge[data-handle=alice]').count(), 2);
    assert.equal(await page.locator('[data-testid=UserCell] .xfc-badge, [data-testid=User-Name] .xfc-badge').count(), 0);
    assert.equal(await page.locator('.xfc-layer').count(), 1);
    passed.push('fetch interception preserves response; user list, zero, timeline, quote, missing data');

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'dynamic'; host.dataset.testid = 'UserCell';
      host.innerHTML = '<div class="avatar" data-testid="UserAvatar-Container-Dave"><a href="/Dave">D</a></div><a class="handle" href="/Dave"><span>@Dave</span></a>';
      document.querySelector('main').append(host);
    });
    await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=dave]')?.textContent === '9,999');
    await page.evaluate(() => {
      const link = document.querySelector('#dynamic a.handle');
      const avatar = document.querySelector('#dynamic .avatar');
      avatar.dataset.testid = 'UserAvatar-Container-Bob'; avatar.querySelector('a').href = '/Bob';
      link.href = '/Bob'; link.querySelector('span').textContent = '@Bob';
      history.pushState(null, '', '/Alice/followers');
    });
    await page.waitForFunction(() => document.querySelectorAll('.xfc-badge[data-handle=bob]').length === 2 && !document.querySelector('.xfc-badge[data-handle=dave]'));
    assert.equal(await page.locator('.xfc-badge[data-handle=bob]').count(), 2);
    assert.equal(await page.locator('.xfc-badge[data-handle=bob]').first().textContent(), '0');
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
    await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=carol]')?.textContent === '2.6万');
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

    // Screenshot regression: a name link can contain an affiliation image.
    // The labels must leave all page geometry unchanged at every tested width.
    await page.evaluate(() => {
      const tweet = document.createElement('article');
      tweet.id = 'search-result'; tweet.dataset.testid = 'tweet';
      tweet.style.cssText = 'display:flex;gap:12px;padding:16px;box-sizing:border-box;font:15px/20px Arial';
      tweet.innerHTML = '<div class="avatar" data-testid="UserAvatar-Container-SearchUser"><a href="/SearchUser">S</a></div>' +
        '<div class="search-body" style="flex:1;min-width:0"><div id="search-name" data-testid="User-Name" style="display:flex;flex-wrap:wrap;align-items:center">' +
        '<a href="/SearchUser"><div style="display:flex;flex-direction:row;align-items:center"><span>Very long author display name</span>' +
        '<span>✓</span><img alt="Affiliation" width="14" height="14" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div></a>' +
        '<div class="metadata" style="display:flex;flex-wrap:wrap"><a href="/SearchUser"><span>@SearchUser</span></a><span> · Sep 16</span></div>' +
        '</div><p id="search-text">Search result content should never move when follower data changes.</p>' +
        '<div id="search-video" style="height:160px;background:#203445">Video placeholder</div></div>';
      document.querySelector('main').append(tweet);
    });
    const geometry = async () => page.evaluate(() => {
      const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
      return ['search-result', 'search-name', 'search-text', 'search-video'].map(rect);
    });
    for (const width of [540, 420, 340, 280]) {
      await page.evaluate(width => {
        document.getElementById('search-result').style.width = width + 'px';
        window.postMessage({ channel: 'x-follower-count:v1', type: 'users', users: [{ handle: 'SearchUser', followers: 153000 }] }, location.origin);
      }, width);
      // The overlay's count can change without changing any header or tweet box.
      await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=searchuser]')?.textContent === '15.3万');
      const initial = await geometry();
      for (const followers of [0, 9999, 123400000, 153000]) {
        await page.evaluate(followers => window.postMessage({ channel: 'x-follower-count:v1', type: 'users', users: [{ handle: 'SearchUser', followers }] }, location.origin), followers);
        await page.waitForFunction(followers => document.querySelector('.xfc-badge[data-handle=searchuser]')?.title.includes(followers.toLocaleString('zh-CN') + ' 粉丝'), followers);
        assert.deepEqual(await geometry(), initial, 'data updates must preserve tweet geometry at width ' + width);
      }
    }
    assert.equal(await page.locator('#search-name .xfc-badge').count(), 0);
    // Compare against a page with the entire follower overlay hidden.
    const displayed = await geometry();
    await page.evaluate(() => document.querySelector('.xfc-layer').style.display = 'none');
    assert.deepEqual(await geometry(), displayed, 'overlay adds zero layout height');
    await page.evaluate(() => document.querySelector('.xfc-layer').style.removeProperty('display'));
    passed.push('affiliation image, wrapping metadata, four narrow widths and count changes preserve exact tweet geometry');

    // Scroll, resize and clipping must track the avatar, without covering menus.
    await page.evaluate(() => { document.getElementById('search-result').scrollIntoView(); window.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => {
      const avatar = document.querySelector('[data-testid="UserAvatar-Container-SearchUser"]').getBoundingClientRect();
      const badge = document.querySelector('.xfc-badge[data-handle=searchuser]');
      return !badge.hidden && Math.abs(badge.getBoundingClientRect().top - (avatar.bottom - 8)) < 1;
    });
    await page.setViewportSize({ width: 800, height: 950 });
    await page.waitForFunction(() => {
      const avatar = document.querySelector('[data-testid="UserAvatar-Container-SearchUser"]').getBoundingClientRect();
      const badge = document.querySelector('.xfc-badge[data-handle=searchuser]').getBoundingClientRect();
      return Math.abs(badge.left + badge.width / 2 - (avatar.left + avatar.width / 2)) < 1;
    });
    await page.evaluate(() => {
      const r = document.querySelector('[data-testid="UserAvatar-Container-SearchUser"]').getBoundingClientRect();
      const cover = document.createElement('div'); cover.id = 'cover';
      cover.style.cssText = `position:fixed;z-index:9999;background:#222;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      document.body.append(cover);
    });
    await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=searchuser]').hidden);
    await page.evaluate(() => document.getElementById('cover').remove());
    await page.waitForFunction(() => !document.querySelector('.xfc-badge[data-handle=searchuser]').hidden);
    passed.push('avatar tracking on scroll and resize; hidden behind dialogs and sticky headers');

    await page.evaluate(() => {
      const handle = document.querySelector('#search-name .metadata a span'); handle.textContent = '@Search...';
      const brand = document.createElement('a'); brand.href = '/Brand'; brand.textContent = 'G';
      document.querySelector('#search-name').prepend(brand);
    });
    await page.waitForFunction(() => document.querySelector('.xfc-badge[data-handle=searchuser]')?.textContent === '15.3万');
    const firstRenderer = await page.evaluate(() => document.documentElement.dataset.xfcRenderer);
    await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'core.js'), 'utf8') });
    for (let i = 0; i < 2; i++) await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'content.js'), 'utf8') });
    await page.waitForFunction(previous => document.documentElement.dataset.xfcRenderer !== previous &&
      document.querySelectorAll('.xfc-layer').length === 1 && document.querySelectorAll('.xfc-badge[data-handle=carol]').length === 1, firstRenderer);
    // Bridge cache contains Alice/Bob/Carol/Dave, not the synthetic search user.
    await page.evaluate(() => window.postMessage({ channel: 'x-follower-count:v1', type: 'users', users: [{ handle: 'SearchUser', followers: 153000 }] }, location.origin));
    await page.waitForFunction(() => document.querySelectorAll('.xfc-badge[data-handle=searchuser]').length === 1);
    passed.push('truncated handle, brand link, repeat injection and a single overlay renderer');
    await page.evaluate(() => {
      document.getElementById('dynamic').remove(); document.getElementById('search-result').remove();
      window.scrollTo(0, 0);
    });
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
