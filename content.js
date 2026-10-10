(() => {
  "use strict";
  const CHANNEL = "x-follower-count:v1";
  const SELECTOR = '[data-testid="UserCell"], [data-testid="User-Name"]';
  const { validHandle, count, formatCount } = globalThis.XFollowerCore;
  globalThis.__xFollowerContentController?.stop();
  const rendererId = crypto.randomUUID();
  const cache = new Map();
  let timer;
  let claimed = false;
  let stopped = false;
  function ownsPage() {
    const root = document.documentElement;
    if (!root) return true;
    if (!claimed) {
      root.dataset.xfcRenderer = rendererId;
      claimed = true;
    }
    return root.dataset.xfcRenderer === rendererId;
  }
  function linkText(link) {
    // Injected labels must not change how a profile link is classified.
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    let text = "", node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement?.closest(".xfc-badge")) text += node.textContent;
    }
    return text.trim();
  }
  function profileHandle(link) {
    try {
      const url = new URL(link.getAttribute("href"), location.href);
      if (url.origin !== location.origin) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      return match ? match[1].toLowerCase() : null;
    } catch { return null; }
  }
  function findOwner(host) {
    const links = [...host.querySelectorAll("a[href]")].filter(link => link.closest(SELECTOR) === host);
    // The handle link avoids choosing an avatar or an @mention in the biography.
    for (const link of links) {
      const handle = profileHandle(link);
      if (!handle) continue;
      // X can shorten an advertising handle in the DOM ("@name...").
      // Its href remains the complete account identity.
      if (linkText(link).startsWith("@")) return { handle, target: link };
    }
    for (const link of links) {
      const handle = profileHandle(link);
      if (handle && link.closest('[data-testid="UserAvatar-Container-' + handle + '"]')) continue;
      if (handle && !link.querySelector("img") && linkText(link)) return { handle, target: link };
    }
    return null;
  }
  function render() {
    timer = null;
    if (stopped || !ownsPage()) return stop();
    // Shared DOM diagnostics let us inspect injection without reading private page state.
    if (document.documentElement) {
      document.documentElement.dataset.xfcVersion = '1.0.2';
      document.documentElement.dataset.xfcUsers = String(cache.size);
    }
    for (const host of document.querySelectorAll(SELECTOR)) {
      const owner = findOwner(host);
      const badges = [...host.querySelectorAll(".xfc-badge")].filter(badge => badge.closest(SELECTOR) === host);
      const followers = owner ? cache.get(owner.handle) : undefined;
      if (!owner || followers === undefined) {
        badges.forEach(badge => badge.remove());
        continue;
      }
      let badge = badges.shift();
      badges.forEach(extra => extra.remove());
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "xfc-badge";
      }
      const label = "粉丝 " + formatCount(followers);
      const title = "@" + owner.handle + " · " + followers.toLocaleString("zh-CN") + " 粉丝（来自当前页面响应）";
      if (badge.textContent !== label) badge.textContent = label;
      if (badge.title !== title) badge.title = title;
      if (badge.dataset.handle !== owner.handle) badge.dataset.handle = owner.handle;
      if (badge.getAttribute("aria-label") !== title) badge.setAttribute("aria-label", title);
      const nameLink = [...host.querySelectorAll('a[href]')].find(link =>
        link.closest(SELECTOR) === host && profileHandle(link) === owner.handle &&
        !link.querySelector('img') && linkText(link) &&
        !linkText(link).startsWith('@'));
      const row = nameLink?.firstElementChild;
      if (row && getComputedStyle(row).display === 'flex' && getComputedStyle(row).flexDirection === 'row') {
        // Keep a mounted badge in place when X adds other name decorations.
        if (badge.parentNode !== row) row.append(badge);
      } else {
        const target = nameLink || owner.target;
        if (target.nextSibling !== badge) target.after(badge);
      }
    }
    // DOM writes above belong to this renderer; they must not schedule it again.
    // Page mutations happen in later tasks and are still observed normally.
    observer.takeRecords();
  }
  function schedule() {
    if (stopped || !ownsPage()) return stop();
    if (timer === undefined || timer === null) timer = setTimeout(render, 80);
  }
  function onMessage(event) {
    if (stopped || !ownsPage()) return stop();
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL ||
        event.data.type !== "users" || !Array.isArray(event.data.users)) return;
    for (const user of event.data.users.slice(0, 5000)) {
      if (!user || !validHandle(user.handle) || count(user.followers) === null) continue;
      const handle = user.handle.toLowerCase();
      cache.delete(handle);
      cache.set(handle, count(user.followers));
    }
    while (cache.size > 5000) cache.delete(cache.keys().next().value);
    schedule();
  }
  window.addEventListener("message", onMessage);
  const observer = new MutationObserver(schedule);
  function stop() {
    stopped = true;
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener("message", onMessage);
  }
  globalThis.__xFollowerContentController = { stop };
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "data-testid"] });
  window.postMessage({ channel: CHANNEL, type: "ready" }, location.origin);
  schedule();
})();
