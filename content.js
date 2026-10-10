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
  let layer;
  let frame;
  let bodyObserved = false;
  const entries = new Map();
  function ownsPage() {
    const root = document.documentElement;
    if (!root) return true;
    if (!claimed) {
      root.dataset.xfcRenderer = rendererId;
      claimed = true;
      // Remove both floating and former inline labels on renderer takeover.
      document.querySelectorAll(".xfc-layer, .xfc-badge").forEach(node => node.remove());
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
      if (link.closest('[data-testid^="UserAvatar-Container-"]')) continue;
      if (handle && linkText(link)) return { handle, target: link };
    }
    return null;
  }
  function findAvatar(host, handle) {
    const scope = host.closest('[data-testid="UserCell"], [data-testid="quoteTweet"], [data-testid="tweet"]');
    if (!scope) return null;
    return [...scope.querySelectorAll('[data-testid^="UserAvatar-Container-"]')].find(avatar =>
      avatar.dataset.testid.slice("UserAvatar-Container-".length).toLowerCase() === handle &&
      [...avatar.querySelectorAll("a[href]")].some(link => profileHandle(link) === handle)) || null;
  }
  function setStyle(node, key, value) {
    if (node.style[key] !== value) node.style[key] = value;
  }
  function positionBadges() {
    frame = null;
    if (stopped || !ownsPage()) return stop();
    const positions = [...entries.values()].map(({ avatar, badge }) => {
      const rect = avatar.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      let visible = avatar.isConnected && rect.width >= 24 && rect.height >= 24 &&
        x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
      if (visible) {
        // Sticky headers, dialogs and scroll clips must also hide the label.
        const hit = document.elementsFromPoint(x, y).find(node => !node.closest(".xfc-layer"));
        visible = !!hit && avatar.contains(hit);
      }
      return { badge, visible, left: Math.min(innerWidth - 29, Math.max(29, x)), top: rect.bottom - 8 };
    });
    for (const { badge, visible, left, top } of positions) {
      if (badge.hidden === visible) badge.hidden = !visible;
      if (!visible) continue;
      setStyle(badge, "left", left + "px");
      setStyle(badge, "top", top + "px");
    }
    observer.takeRecords();
  }
  function schedulePositions() {
    if (stopped || !ownsPage()) return stop();
    if (frame === undefined || frame === null) frame = requestAnimationFrame(positionBadges);
  }
  function render() {
    timer = null;
    if (stopped || !ownsPage()) return stop();
    const root = document.documentElement;
    if (!root || !document.body) return;
    root.dataset.xfcVersion = "1.0.3";
    root.dataset.xfcUsers = String(cache.size);
    if (!layer?.isConnected) {
      layer = document.createElement("div");
      layer.className = "xfc-layer";
      document.body.append(layer);
    }
    if (!bodyObserved) { resizeObserver.observe(document.body); bodyObserved = true; }
    const retained = new Set(), avatars = new Set();
    for (const host of document.querySelectorAll(SELECTOR)) {
      const owner = findOwner(host);
      const followers = owner ? cache.get(owner.handle) : undefined;
      const avatar = owner && followers !== undefined ? findAvatar(host, owner.handle) : null;
      if (!avatar || avatars.has(avatar)) continue;
      retained.add(host);
      avatars.add(avatar);
      let entry = entries.get(host);
      if (!entry) {
        entry = { badge: document.createElement("a") };
        entry.badge.className = "xfc-badge";
        entry.badge.hidden = true;
        entries.set(host, entry);
      }
      entry.avatar = avatar;
      const badge = entry.badge;
      const label = formatCount(followers);
      const title = "@" + owner.handle + " · " + followers.toLocaleString("zh-CN") + " 粉丝（来自当前页面响应）";
      if (badge.textContent !== label) badge.textContent = label;
      if (badge.title !== title) badge.title = title;
      if (badge.dataset.handle !== owner.handle) badge.dataset.handle = owner.handle;
      if (badge.getAttribute("aria-label") !== title) badge.setAttribute("aria-label", title);
      const href = "/" + owner.handle;
      if (badge.getAttribute("href") !== href) badge.setAttribute("href", href);
      if (badge.parentNode !== layer) layer.append(badge);
    }
    for (const [host, entry] of entries) {
      if (!retained.has(host)) { entry.badge.remove(); entries.delete(host); }
    }
    positionBadges();
    // The overlay has no space in the page layout; its writes need no render.
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
  const observer = new MutationObserver(records => {
    if (records.some(record => !layer?.contains(record.target))) schedule();
  });
  const resizeObserver = new ResizeObserver(schedulePositions);
  window.addEventListener("scroll", schedulePositions, true);
  window.addEventListener("resize", schedulePositions);
  function stop() {
    stopped = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    observer.disconnect();
    resizeObserver.disconnect();
    layer?.remove();
    entries.clear();
    window.removeEventListener("message", onMessage);
    window.removeEventListener("scroll", schedulePositions, true);
    window.removeEventListener("resize", schedulePositions);
  }
  globalThis.__xFollowerContentController = { stop };
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "data-testid"] });
  window.postMessage({ channel: CHANNEL, type: "ready" }, location.origin);
  schedule();
})();
