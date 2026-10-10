(() => {
  "use strict";
  function collectUsers(payload) {
    const found = new Map();
    const seen = new WeakSet();
    const stack = [payload];
    let visited = 0;
    while (stack.length && visited++ < 100000) {
      const item = stack.pop();
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      const handle = item.legacy?.screen_name ?? item.core?.screen_name ?? item.screen_name;
      let followers = item.relationship_counts?.followers ?? item.legacy?.followers_count ??
        item.followers_count ?? item.public_metrics?.followers_count;
      if (typeof followers === "string" && /^\d+$/.test(followers)) followers = Number(followers);
      if (typeof handle === "string" && /^[A-Za-z0-9_]{1,15}$/.test(handle) &&
          Number.isSafeInteger(followers) && followers >= 0) found.set(handle.toLowerCase(), followers);
      // Reverse for LIFO traversal so later records override earlier records.
      for (const value of Object.values(item).reverse()) if (value && typeof value === "object") stack.push(value);
    }
    return [...found].map(([handle, followers]) => ({ handle, followers }));
  }
  globalThis.XFollowerNetworkCore = Object.freeze({ collectUsers });
})();
