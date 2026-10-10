(() => {
  "use strict";
  const CHANNEL = "x-follower-count:v1";
  const SELECTOR = '[data-testid="UserCell"], [data-testid="User-Name"]';
  const { validHandle, count, formatCount } = globalThis.XFollowerCore;
  const cache = new Map();
  let timer;
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
      const spans = [...link.querySelectorAll("span")];
      const target = spans.find(span => span.textContent.trim().toLowerCase() === "@" + handle);
      if (target || link.textContent.trim().toLowerCase() === "@" + handle) return { handle, target: target || link };
    }
    for (const link of links) {
      const handle = profileHandle(link);
      if (handle && link.closest('[data-testid="UserAvatar-Container-' + handle + '"]')) continue;
      if (handle && !link.querySelector("img") && link.textContent.trim()) return { handle, target: link };
    }
    return null;
  }
  function render() {
    timer = null;
    // Shared DOM diagnostics let us inspect injection without reading private page state.
    if (document.documentElement) {
      document.documentElement.dataset.xfcVersion = '1.0.1';
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
        !link.querySelector('img') && link.textContent.trim() &&
        link.textContent.trim().toLowerCase() !== '@' + owner.handle);
      const row = nameLink?.firstElementChild;
      if (row && getComputedStyle(row).display === 'flex' && getComputedStyle(row).flexDirection === 'row') {
        if (badge.parentNode !== row || row.lastChild !== badge) row.append(badge);
      } else {
        const target = nameLink || owner.target;
        if (target.nextSibling !== badge) target.after(badge);
      }
    }
  }
  function schedule() {
    if (timer === undefined || timer === null) timer = setTimeout(render, 80);
  }
  window.addEventListener("message", event => {
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
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "data-testid"] });
  window.postMessage({ channel: CHANNEL, type: "ready" }, location.origin);
  schedule();
})();
