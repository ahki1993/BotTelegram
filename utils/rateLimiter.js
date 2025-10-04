// Semplice rate limiter in-memory per proteggere endpoint sensibili
const map = new Map();
const WINDOW_MS = 5000; // 5s
const MAX = 5; // max 5 richieste per finestra

function isAllowed(key) {
  const now = Date.now();
  const entry = map.get(key) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    // reset window
    entry.count = 1;
    entry.start = now;
    map.set(key, entry);
    return true;
  }
  entry.count++;
  map.set(key, entry);
  return entry.count <= MAX;
}

module.exports = { isAllowed };
