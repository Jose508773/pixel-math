export const WIDTH = 960;
export const HEIGHT = 540;
export const TILE = 32;
export const WORLD_COLS = 24;
export const WORLD_ROWS = 14;
export const FLOOR_Y = HEIGHT - 84;

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

export const XP_THRESHOLDS = [0, 40, 100, 180, 280, 410, 560, 760, 1000];
