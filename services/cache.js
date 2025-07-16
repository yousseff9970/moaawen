// utils/cache.js
const cache = new Map();

module.exports = {
  set: (key, value) => cache.set(key, value),
  get: (key) => cache.get(key),
  entries: () => Array.from(cache.entries()), // ✅ needed for for..of
  keys: (prefix = '') => {
    return Array.from(cache.keys()).filter(key => key.startsWith(prefix));
  },
  clear: () => cache.clear()
};
