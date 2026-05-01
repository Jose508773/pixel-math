// save.js — tiny persistence layer for high scores, stats, and settings.
// Why: kids love seeing progress. Tracking best score and accuracy across
// sessions adds replay motivation without any backend.

// Single localStorage key keeps everything together so we never get out of sync.
const SAVE_KEY = "pixelMath.save.v1";

// Default snapshot — also acts as a schema doc.
// Why a default object: localStorage may be empty, blocked, or corrupt; we
// always want a valid object to merge user data into.
const DEFAULT_SAVE = {
  highScore: 0,            // Best score ever achieved across all runs.
  bestLevel: 1,            // Highest player level reached.
  bestEncounter: 0,        // Furthest encounter index defeated (≈ "stage").
  totalProblems: 0,        // Lifetime number of problems attempted.
  correctProblems: 0,      // Lifetime correct answers (for accuracy %).
  settings: {
    muted: false,          // Sound on/off — persists across sessions.
    difficulty: "normal",  // "easy" | "normal" | "hard"
  },
};

/**
 * Reads the save from localStorage, returning DEFAULT_SAVE if anything is off.
 * Why deep merge: lets us add new fields later without breaking old saves.
 */
export function loadSave() {
  try {
    // Pull raw JSON; null if key missing.
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    // Parse and merge over defaults so any new fields get filled in.
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SAVE,
      ...parsed,
      // Settings is a nested object — merge it too so toggles persist correctly.
      settings: { ...DEFAULT_SAVE.settings, ...(parsed.settings || {}) },
    };
  } catch {
    // localStorage may be disabled (private mode); start fresh in memory.
    return structuredClone(DEFAULT_SAVE);
  }
}

/**
 * Writes the current save back to localStorage.
 * Wrapped in try/catch because storage can be full or blocked.
 */
export function persistSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Silent fail — game still works, we just won't remember stats next time.
  }
}

/**
 * Update the save with the result of a finished run, only writing fields
 * that actually beat the previous record (so we never regress stats).
 */
export function recordRunResult(save, { score, level, encounterIndex }) {
  // Take Math.max so a worse run never overwrites a better record.
  save.highScore = Math.max(save.highScore, score);
  save.bestLevel = Math.max(save.bestLevel, level);
  save.bestEncounter = Math.max(save.bestEncounter, encounterIndex);
  persistSave(save);
  return save;
}

/**
 * Increment lifetime problem counters — call once per submitted answer.
 * @param {boolean} correct — was the answer right?
 */
export function recordAnswer(save, correct) {
  save.totalProblems += 1;
  if (correct) save.correctProblems += 1;
  persistSave(save);
}

/**
 * Returns accuracy as a 0–100 integer percent (or 0 if no problems yet).
 * Why integer: we render it on a pixel HUD where decimals look noisy.
 */
export function accuracyPercent(save) {
  if (save.totalProblems === 0) return 0;
  return Math.round((save.correctProblems / save.totalProblems) * 100);
}
