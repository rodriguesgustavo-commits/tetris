const PREFIX = "tetrisBlast.";

export function readSetting(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage might be unavailable (private mode) — game still works */
  }
}

export function readBest(mode) {
  const value = Number(readSetting(`best.${mode}`, 0));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function writeBest(mode, score) {
  writeSetting(`best.${mode}`, Math.max(0, Math.floor(score)));
}