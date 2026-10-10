(() => {
  "use strict";
  if (window.__xFollowerNetworkInstalled) return;
  window.__xFollowerNetworkInstalled = true;
  const CHANNEL = "x-follower-count:v1";
  const { collectUsers } = globalThis.XFollowerNetworkCore;
  const cache = new Map();
  function publish(users) {
    if (users.length) window.postMessage({ channel: CHANNEL, type: "users", users }, location.origin);
  }
  function consume(payload) {
    const users = collectUsers(payload);
    for (const user of users) {
      cache.delete(user.handle);
      cache.set(user.handle, user);
    }
    while (cache.size > 5000) cache.delete(cache.keys().next().value);
    publish(users);
  }
  function isUserResponse(input) {
    try {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
      return /^(?:(?:api|www)\.)?(?:x|twitter)\.com$/.test(url.hostname) &&
        (/\/graphql\//.test(url.pathname) || /^\/(?:i\/api\/)?(?:1\.1|2)\//.test(url.pathname));
    } catch { return false; }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const pending = Reflect.apply(originalFetch, this, args);
    if (!isUserResponse(args[0])) return pending;
    return pending.then(response => {
      try {
        if (response.ok) void response.clone().json().then(consume).catch(() => {});
      } catch { /* Never interfere with the page's response. */ }
      return response;
    });
  };
  const urls = new WeakMap();
  const observed = new WeakSet();
  const prototype = XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  prototype.open = function (method, url, ...rest) {
    urls.set(this, url);
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  prototype.send = function (...args) {
    if (!observed.has(this)) {
      observed.add(this);
      this.addEventListener("load", () => {
        if (!isUserResponse(urls.get(this)) || this.status < 200 || this.status >= 300) return;
        try {
          if (this.responseType === "json") consume(this.response);
          else if (!this.responseType || this.responseType === "text") consume(JSON.parse(this.responseText));
        } catch { /* Non-JSON responses are irrelevant. */ }
      });
    }
    return Reflect.apply(originalSend, this, args);
  };
  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin &&
        event.data?.channel === CHANNEL && event.data.type === "ready") publish([...cache.values()]);
  });
  // Some X routes hydrate user data before the first network response.
  function readInitialData() {
    try { if (window.__INITIAL_STATE__) consume(window.__INITIAL_STATE__); } catch {}
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      try { consume(JSON.parse(script.textContent)); } catch {}
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", readInitialData, { once: true });
  else readInitialData();
})();
