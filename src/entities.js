// entities.js — factory functions for the player and enemies, plus XP logic.

import { DIFFICULTY, ENEMY_ARCHETYPES, XP_THRESHOLDS } from "./config.js";

/**
 * Create a fresh player. Called once at game start and on `reset`.
 * Why a factory: ensures every new run begins with a clean state object.
 */
export function makePlayer() {
  return {
    level: 1,
    xp: 0,
    maxHp: 100,
    hp: 100,
    damageMultiplier: 1,
    bonusWindow: 4.6,        // Seconds within which fast answers earn bonus dmg.
    combo: 0,                // Consecutive correct answers — feeds combo bonus.
    bestCombo: 0,            // Best combo this run (shown on game over).
    x: 220,
    y: 320,
    worldStep: 0,
    abilities: {             // Unlocked at level thresholds in applyXp().
      hint: false,
      freeze: false,
      double: false,
    },
    cooldowns: {             // Internal flags for active abilities.
      hint: 0,
      freeze: 0,
      double: 0,
    },
    freezeCharges: 0,        // Number of freezes available; gained on level-up.
  };
}

/**
 * Build an enemy for the given encounter index, applying difficulty scaling.
 * Picks a boss archetype every 5th encounter; otherwise one of the regular foes.
 */
export function makeEnemy(encounterIndex, difficulty = "normal") {
  // Every 5th fight (index 4, 9, 14, ...) is a boss.
  const isBossSlot = encounterIndex % 5 === 4;
  // Filter archetypes: boss slot pulls from boss-flagged entries, others from regular.
  const list = isBossSlot
    ? ENEMY_ARCHETYPES.filter((e) => e.boss)
    : ENEMY_ARCHETYPES.filter((e) => !e.boss);
  // Clone so we don't mutate the static archetype object.
  const base = structuredClone(list[Math.floor(Math.random() * list.length)]);
  // HP scales 8% per encounter — keeps fights challenging at later stages.
  const scale = 1 + encounterIndex * 0.08;
  // Look up difficulty multipliers (default to normal if unknown).
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;

  return {
    ...base,
    hp: Math.round(base.maxHp * scale * diff.enemyHp),
    maxHp: Math.round(base.maxHp * scale * diff.enemyHp),
    // Clamp damage scale at 2x so late-game isn't an instant-kill loop.
    damage: Math.max(1, Math.round(base.damage * Math.min(scale, 2) * diff.enemyDmg)),
    speed: base.speed + encounterIndex * 0.01,
  };
}

/**
 * Award XP, level up the player if thresholds crossed, and return whether a
 * level-up occurred so the caller can play a fanfare.
 */
export function applyXp(player, amount) {
  player.xp += amount;
  let leveled = false;

  // Loop because a single XP grant could cross multiple thresholds.
  while (player.level < XP_THRESHOLDS.length - 1 && player.xp >= XP_THRESHOLDS[player.level]) {
    player.level += 1;
    // Stat bumps per level — chosen so a fresh player can survive ~3 hits.
    player.maxHp += 16;
    player.hp = Math.min(player.maxHp, player.hp + 22); // Partial heal on level-up.
    player.damageMultiplier += 0.12;
    player.bonusWindow += 0.28;
    leveled = true;

    // Ability unlocks at level milestones.
    if (player.level >= 2) player.abilities.hint = true;
    if (player.level >= 3) {
      player.abilities.freeze = true;
      player.freezeCharges = 1;
    }
    if (player.level >= 4) player.abilities.double = true;
  }

  return leveled;
}

/**
 * Returns how many XP points until the next level (0 at max level).
 * Used to render the HUD's "XP" indicator.
 */
export function xpToNextLevel(player) {
  const next = XP_THRESHOLDS[player.level] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1];
  return Math.max(0, next - player.xp);
}
