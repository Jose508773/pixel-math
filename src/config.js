// config.js — game-wide constants. Pulled out so balance tweaks live in one place.

// Canvas dimensions; the canvas in index.html matches these exactly.
export const WIDTH = 960;
export const HEIGHT = 540;
// Tile size for any future grid logic (currently mostly cosmetic).
export const TILE = 32;
export const WORLD_COLS = 24;
export const WORLD_ROWS = 14;
// Y-coordinate of the floor sprites stand on (anchored at their feet).
export const FLOOR_Y = HEIGHT - 84;

/**
 * Enemy roster — each has stats plus a `key` matching its image asset name
 * (e.g. "goblin" → "enemy_goblin.png"). Bosses get the `boss: true` flag,
 * which enables multi-step problems and the volcano background.
 */
export const ENEMY_ARCHETYPES = [
  {
    key: "goblin",
    name: "Goblin",
    palette: ["#5ac54f", "#2f8f3d", "#193c24"],
    maxHp: 30,
    damage: 9,
    speed: 1.3,
    xp: 18,
    difficultyBias: 0,
  },
  {
    key: "orc",
    name: "Orc",
    palette: ["#8cc751", "#496d31", "#1d2918"],
    maxHp: 42,
    damage: 12,
    speed: 1,
    xp: 24,
    difficultyBias: 1,
  },
  // Added: skeleton uses the existing PNG asset, gives more variety per stage.
  {
    key: "skeleton",
    name: "Skeleton",
    palette: ["#dcd2b4", "#7a6a44", "#1f1d18"],
    maxHp: 36,
    damage: 11,
    speed: 1.15,
    xp: 22,
    difficultyBias: 1,
  },
  {
    key: "dragon",
    name: "Ash Dragon",
    palette: ["#f08a5d", "#b83b5e", "#2a1a2e"],
    maxHp: 82,
    damage: 18,
    speed: 0.95,
    xp: 70,
    difficultyBias: 3,
    boss: true,
  },
];

/**
 * XP needed to reach each level. Index = current level.
 * e.g. XP_THRESHOLDS[1] = 40 means level 2 unlocks at 40 XP.
 */
export const XP_THRESHOLDS = [0, 40, 100, 180, 280, 410, 560, 760, 1000];

/**
 * Difficulty multipliers — applied to enemy HP/damage and player damage.
 * Easy mode is gentler so kids don't get walled early.
 */
export const DIFFICULTY = {
  easy:   { enemyHp: 0.75, enemyDmg: 0.65, playerDmg: 1.20, label: "EASY" },
  normal: { enemyHp: 1.00, enemyDmg: 1.00, playerDmg: 1.00, label: "NORMAL" },
  hard:   { enemyHp: 1.25, enemyDmg: 1.30, playerDmg: 0.90, label: "HARD" },
};
