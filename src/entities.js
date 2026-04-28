import { ENEMY_ARCHETYPES, XP_THRESHOLDS } from "./config.js";

export function makePlayer() {
  return {
    level: 1,
    xp: 0,
    maxHp: 100,
    hp: 100,
    damageMultiplier: 1,
    bonusWindow: 4.6,
    combo: 0,
    x: 220,
    y: 320,
    worldStep: 0,
    abilities: {
      hint: false,
      freeze: false,
      double: false,
    },
    cooldowns: {
      hint: 0,
      freeze: 0,
      double: 0,
    },
    freezeCharges: 0,
  };
}

export function makeEnemy(encounterIndex) {
  const cycle = encounterIndex % 5 === 4;
  const list = cycle ? [ENEMY_ARCHETYPES[3]] : ENEMY_ARCHETYPES.slice(0, 3);
  const base = structuredClone(list[Math.floor(Math.random() * list.length)]);
  const scale = 1 + encounterIndex * 0.08;

  return {
    ...base,
    hp: Math.round(base.maxHp * scale),
    maxHp: Math.round(base.maxHp * scale),
    damage: Math.round(base.damage * Math.min(scale, 2)),
    speed: base.speed + encounterIndex * 0.01,
  };
}

export function applyXp(player, amount) {
  player.xp += amount;
  let leveled = false;

  while (player.level < XP_THRESHOLDS.length - 1 && player.xp >= XP_THRESHOLDS[player.level]) {
    player.level += 1;
    player.maxHp += 16;
    player.hp = Math.min(player.maxHp, player.hp + 22);
    player.damageMultiplier += 0.12;
    player.bonusWindow += 0.28;
    leveled = true;

    if (player.level >= 2) player.abilities.hint = true;
    if (player.level >= 3) {
      player.abilities.freeze = true;
      player.freezeCharges = 1;
    }
    if (player.level >= 4) player.abilities.double = true;
  }

  return leveled;
}

export function xpToNextLevel(player) {
  const next = XP_THRESHOLDS[player.level] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1];
  return Math.max(0, next - player.xp);
}
