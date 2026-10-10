(() => {
  "use strict";
  const validHandle = value => typeof value === "string" && /^[A-Za-z0-9_]{1,15}$/.test(value);
  function count(value) {
    if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  function formatCount(value) {
    if (value < 10000) return value.toLocaleString("zh-CN");
    const divisor = value < 100000000 ? 10000 : 100000000;
    return (value / divisor).toFixed(1).replace(/\.0$/, "") + (divisor === 10000 ? "万" : "亿");
  }
  globalThis.XFollowerCore = Object.freeze({ validHandle, count, formatCount });
})();
