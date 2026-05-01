// game.js — orchestrates state, input, render, and combat for Pixel Math.
// This file got pretty long, so it's organised in sections:
//   1. Constructor + state
//   2. Input bindings (keyboard, form, buttons)
//   3. Settings & persistence
//   4. Combat lifecycle (enter, exit, problems, abilities, answer)
//   5. Update / render loop
//   6. Drawing helpers (sky, mage, monster, HUD, FX)
//   7. Public hooks (window.advanceTime, renderGameToText)

import { AudioController } from "./audio.js";
import { DIFFICULTY, FLOOR_Y, HEIGHT, TILE, WIDTH, WORLD_COLS, WORLD_ROWS } from "./config.js";
import { applyXp, makeEnemy, makePlayer, xpToNextLevel } from "./entities.js";
import { generateProblem, normalizeAnswer } from "./math.js";
import { accuracyPercent, loadSave, persistSave, recordAnswer, recordRunResult } from "./save.js";

// Convenience clamp — keeps a value inside a [min, max] window.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Encouraging messages for kids — rotated randomly so feedback feels fresh.
const KID_PRAISE = [
  "Spell hits true!",
  "You're a math wizard!",
  "Sharp thinking!",
  "Nice spellwork!",
  "Critical strike!",
  "Brilliant!",
];
const KID_TRY_AGAIN = [
  "The spell fizzles. Keep going!",
  "Almost — try again!",
  "Don't worry, every wizard misses sometimes.",
  "Spell missed. Stay focused!",
];

export class Game {
  // ─── 1. Constructor + state ─────────────────────────────────────────────
  constructor(canvas, ui) {
    this.canvas = canvas;
    // 2D context for all canvas drawing operations.
    this.ctx = canvas.getContext("2d");
    this.ui = ui;
    this.audio = new AudioController();

    // Persistent save data (high score, settings) — loaded once at startup.
    this.save = loadSave();
    // Apply persisted mute setting to audio so first SFX respects user choice.
    this.audio.setMuted(this.save.settings.muted);

    // Single state object holds everything that could change between frames.
    // Keeping it grouped makes reset() trivial and renderGameToText() reliable.
    this.state = {
      mode: "title",            // "title" | "combat" | "gameover" | "paused"
      previousMode: null,       // Used by pause to restore the prior mode.
      phase: "idle",            // "player" | "enemy" | "intro" inside combat.
      tick: 0,                  // Total seconds since boot — used for animations.
      worldTime: 0,
      encounterIndex: 0,
      player: makePlayer(),
      enemy: null,
      enemiesOnMap: this.spawnWorldEnemies(),
      particles: [],
      problem: null,
      freezeTimer: 0,
      message: "Press Enter to begin your math quest.",
      floatingText: [],
      answerOpenedAt: 0,
      cameraShake: 0,
      score: 0,
      lastOutcome: "",
      environment: "Emerald Forest",
      // Visual polish state
      hpDisplay: 1,             // Smoothed player-HP fraction (lerps to actual).
      enemyHpDisplay: 1,        // Same idea for the enemy bar.
      flash: { color: null, life: 0 }, // Brief full-screen flash on big events.
      bossIntro: 0,             // Countdown timer for boss reveal animation.
      hitStop: 0,               // Brief pause after a hit for impact.
    };

    // Set of currently-pressed lowercase keys (for held movement, etc.).
    this.keys = new Set();
    // Cache UI element refs for readability later.
    this.answerInput = ui.answerInput;
    this.problemText = ui.problemText;
    this.feedbackText = ui.feedbackText;
    this.combatUi = ui.combatUi;
    this.choiceGrid = ui.choiceGrid;
    this.worldUi = ui.worldUi;
    this.encounterButton = ui.encounterButton;
    this.settingsPanel = ui.settingsPanel;
    this.muteToggle = ui.muteToggle;
    this.difficultyButtons = ui.difficultyButtons || [];
    this.pauseOverlay = ui.pauseOverlay;
    this.statsDisplay = ui.statsDisplay;

    this.bindEvents();
    this.applySettingsToUi();
    this.refreshStatsDisplay();
    this.syncCombatUi();
  }

  // ─── 2. Input bindings ──────────────────────────────────────────────────
  bindEvents() {
    // Keyboard handler — covers menus, abilities, fullscreen, pause.
    window.addEventListener("keydown", (event) => {
      // Stop arrow keys from scrolling the page.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }

      // Global hotkeys (work in any mode):
      const k = event.key.toLowerCase();
      if (k === "f") this.toggleFullscreen();
      if (k === "m") this.toggleMute();
      if (k === "p") this.togglePause();

      // Mode-specific keys:
      if (this.state.mode === "title" && event.key === "Enter") {
        this.startAdventure();
        return;
      }
      if (this.state.mode === "gameover" && event.key === "Enter") {
        this.reset();
        return;
      }
      if (this.state.mode === "combat") {
        // Abilities mapped to 1/2/3 — same fingers-on-home-row idea as classic RPGs.
        if (event.key === "1") this.castAbility("hint");
        if (event.key === "2") this.castAbility("freeze");
        if (event.key === "3") this.castAbility("double");
      }

      this.keys.add(k);
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.key.toLowerCase());
    });

    // Submit answer on Enter inside the form.
    this.ui.answerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitAnswer(this.answerInput.value);
    });

    // Big "Begin Quest" button — same effect as Enter on title screen.
    this.encounterButton.addEventListener("click", () => {
      if (this.state.mode === "title") {
        this.startAdventure();
      } else if (this.state.mode === "explore") {
        this.enterCombat();
      } else if (this.state.mode === "gameover") {
        this.reset();
      }
    });

    // First focus on the input is also the first user gesture — perfect time
    // to lazily start the AudioContext.
    this.answerInput.addEventListener("focus", () => {
      this.audio.ensure();
    });

    // Settings: mute toggle.
    if (this.muteToggle) {
      this.muteToggle.addEventListener("click", () => this.toggleMute());
    }

    // Settings: difficulty buttons. Each carries a data-difficulty attribute.
    this.difficultyButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.dataset.difficulty;
        if (value) this.setDifficulty(value);
      });
    });
  }

  // ─── 3. Settings & persistence ──────────────────────────────────────────

  /**
   * Apply current save.settings to UI elements (button states, mute label).
   * Called on init and after any setting change.
   */
  applySettingsToUi() {
    if (this.muteToggle) {
      this.muteToggle.textContent = this.save.settings.muted ? "🔈 Sound Off" : "🔊 Sound On";
      this.muteToggle.setAttribute("aria-pressed", String(this.save.settings.muted));
    }
    this.difficultyButtons.forEach((btn) => {
      const isActive = btn.dataset.difficulty === this.save.settings.difficulty;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  /**
   * Refresh the title-screen stats panel from save data.
   * Called when title screen is shown and after each game-over.
   */
  refreshStatsDisplay() {
    if (!this.statsDisplay) return;
    const accuracy = accuracyPercent(this.save);
    this.statsDisplay.innerHTML = `
      <span class="stat-item">★ Best Score: <b>${this.save.highScore}</b></span>
      <span class="stat-item">⚔ Best Stage: <b>${this.save.bestEncounter + 1}</b></span>
      <span class="stat-item">✦ Lvl Reached: <b>${this.save.bestLevel}</b></span>
      <span class="stat-item">✓ Accuracy: <b>${accuracy}%</b></span>
    `;
  }

  toggleMute() {
    this.save.settings.muted = !this.save.settings.muted;
    this.audio.setMuted(this.save.settings.muted);
    persistSave(this.save);
    this.applySettingsToUi();
    if (!this.save.settings.muted) this.audio.click();
  }

  setDifficulty(value) {
    if (!DIFFICULTY[value]) return;
    this.save.settings.difficulty = value;
    persistSave(this.save);
    this.applySettingsToUi();
    this.audio.click();
  }

  togglePause() {
    if (this.state.mode === "title" || this.state.mode === "gameover") return;
    if (this.state.mode === "paused") {
      // Resume — restore the mode we were in before pausing.
      this.state.mode = this.state.previousMode || "combat";
      this.pauseOverlay?.classList.add("hidden");
      this.answerInput.focus();
    } else {
      this.state.previousMode = this.state.mode;
      this.state.mode = "paused";
      this.pauseOverlay?.classList.remove("hidden");
      this.answerInput.blur();
    }
    this.draw();
  }

  // ─── 4. Combat lifecycle ────────────────────────────────────────────────

  reset() {
    // Brand-new run — keep save data and audio settings, replace transient state.
    this.state = {
      ...this.state,
      mode: "title",
      previousMode: null,
      phase: "idle",
      tick: 0,
      worldTime: 0,
      encounterIndex: 0,
      player: makePlayer(),
      enemy: null,
      enemiesOnMap: this.spawnWorldEnemies(),
      particles: [],
      problem: null,
      freezeTimer: 0,
      message: "Press Enter to begin your math quest.",
      floatingText: [],
      answerOpenedAt: 0,
      cameraShake: 0,
      score: 0,
      lastOutcome: "",
      environment: "Emerald Forest",
      hpDisplay: 1,
      enemyHpDisplay: 1,
      flash: { color: null, life: 0 },
      bossIntro: 0,
      hitStop: 0,
    };
    this.answerInput.value = "";
    this.feedbackText.textContent = "";
    this.refreshStatsDisplay();
    this.syncCombatUi();
    this.draw();
  }

  startAdventure() {
    this.audio.ensure();
    this.enterCombat();
  }

  spawnWorldEnemies() {
    // Place a small group of decorative monsters on the world view.
    return Array.from({ length: 5 }, (_, index) => ({
      id: `mob-${index}-${Math.random().toString(16).slice(2, 8)}`,
      x: 470 + index * 84,
      y: 340 + (index % 2) * 28,
      type: ["goblin", "orc"][index % 2],
      bob: Math.random() * Math.PI * 2,
    }));
  }

  enterCombat() {
    this.state.mode = "combat";
    this.state.phase = "player";
    this.state.enemy = makeEnemy(this.state.encounterIndex, this.save.settings.difficulty);
    // Initialise smoothed enemy HP bar at full so it animates only on hits.
    this.state.enemyHpDisplay = 1;
    this.state.problem = null;
    this.state.freezeTimer = 0;
    this.state.message = `${this.state.enemy.name} blocks the path.`;
    this.state.environment = this.state.enemy.boss ? "Obsidian Gate" : "Battlefield";
    // Boss intro: 1.6 seconds of pause + animation before the first problem.
    if (this.state.enemy.boss) {
      this.state.bossIntro = 1.6;
      this.flashScreen("#ff6e3a", 0.45);
      this.audio.enemyAttack();
    }
    this.answerInput.value = "";
    this.feedbackText.textContent = "";
    this.rollProblem();
    this.syncCombatUi();
    this.answerInput.focus();
    this.draw();
  }

  exitCombat(victory) {
    if (victory) {
      const xpEarned = this.state.enemy.xp;
      const leveled = applyXp(this.state.player, xpEarned);
      this.state.score += xpEarned * 10;
      const bossBeaten = Boolean(this.state.enemy.boss);
      // Choose victory message — celebrate boss kills more loudly for kids.
      const victoryMsg = bossBeaten
        ? `Boss defeated! +${xpEarned} XP`
        : leveled
          ? `Victory! +${xpEarned} XP. Level up!`
          : `Victory! +${xpEarned} XP earned.`;
      if (leveled) this.audio.levelUp();
      else if (bossBeaten) this.audio.victory();
      // Persist best-ever stats so kids see progress between runs.
      recordRunResult(this.save, {
        score: this.state.score,
        level: this.state.player.level,
        encounterIndex: this.state.encounterIndex + 1,
      });
      // Track best combo of this run for game-over stats.
      this.state.player.bestCombo = Math.max(this.state.player.bestCombo, this.state.player.combo);
      this.state.encounterIndex += 1;
      this.state.environment = this.state.encounterIndex >= 6 ? "Frost Dungeon" : "Emerald Forest";
      this.state.enemy = null;
      this.state.problem = null;
      this.answerInput.blur();
      // Brief pause to show victory message, then jump straight into next battle
      this.state.mode = "combat";
      this.state.message = victoryMsg;
      this.flashScreen("#7fffd4", 0.25);
      this.syncCombatUi();
      this.draw();
      window.setTimeout(() => this.enterCombat(), 1400);
      return;
    } else {
      // Defeat — show game over and persist stats.
      this.state.mode = "gameover";
      this.state.message = "The monsters overwhelmed you. Press Enter to try again.";
      recordRunResult(this.save, {
        score: this.state.score,
        level: this.state.player.level,
        encounterIndex: this.state.encounterIndex,
      });
      this.refreshStatsDisplay();
    }
    this.state.enemy = null;
    this.state.problem = null;
    this.answerInput.blur();
    this.syncCombatUi();
    this.draw();
  }

  rollProblem(simplified = false) {
    const enemy = this.state.enemy;
    const forcedSimple = simplified || this.state.player.cooldowns.hint > 0;
    // Pass current difficulty so math.js can adjust which problem types appear.
    this.state.problem = generateProblem(
      this.state.encounterIndex + this.state.player.level,
      enemy?.difficultyBias || 0,
      forcedSimple,
      Boolean(enemy?.boss),
      this.save.settings.difficulty,
    );
    this.problemText.textContent = `${this.state.problem.prompt} = ?`;
    this.renderChoices();
    this.state.answerOpenedAt = performance.now();
    this.state.phase = "player";
    this.answerInput.value = "";
    this.feedbackText.textContent = "Solve quickly for bonus damage!";
    this.draw();
  }

  /**
   * Build 4 multiple-choice options including the correct answer.
   * Why a Set: prevents duplicates when a random offset accidentally hits the
   * real answer.
   */
  buildChoices(answer) {
    const choices = new Set([answer]);
    // Spread = how far decoys deviate from the right answer.
    const spread = Math.max(2, Math.ceil(Math.abs(answer) * 0.25));
    // Try up to ~30 offsets so we don't loop forever on tiny answers.
    let tries = 0;
    while (choices.size < 4 && tries < 30) {
      tries += 1;
      const offset = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
      const next = Math.round((answer + offset) * 10) / 10;
      // Skip negatives for kid-friendliness; skeptical of zeros for fractions.
      if (next !== answer && next >= 0) choices.add(next);
    }
    // Fallback: if we still don't have 4, pad with answer ± 1, 2, 3.
    let pad = 1;
    while (choices.size < 4) {
      choices.add(answer + pad);
      if (answer - pad >= 0) choices.add(answer - pad);
      pad += 1;
    }
    return [...choices].sort(() => Math.random() - 0.5);
  }

  renderChoices() {
    this.choiceGrid.replaceChildren();
    if (!this.state.problem) return;

    this.buildChoices(this.state.problem.answer).forEach((choice, idx) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(choice);
      // ARIA + numeric hotkeys (4–7) so keyboard users have parity.
      button.setAttribute("aria-label", `Answer choice ${idx + 1}: ${choice}`);
      button.addEventListener("click", () => this.submitAnswer(choice));
      this.choiceGrid.append(button);
    });
  }

  castAbility(type) {
    const { player } = this.state;
    if (!player.abilities[type]) return; // Locked — silently ignore.

    if (type === "hint" && player.cooldowns.hint === 0) {
      player.cooldowns.hint = 1;
      this.state.message = "Hint spell active. Next problem is simpler.";
      this.audio.click();
      this.rollProblem(true);
      return;
    }

    if (type === "freeze" && player.abilities.freeze && player.freezeCharges > 0 && this.state.freezeTimer <= 0) {
      this.state.freezeTimer = 5;
      player.freezeCharges -= 1;
      this.state.message = "Time slows around the enemy.";
      this.flashScreen("#8eddff", 0.18);
      this.audio.click();
      this.draw();
    }

    if (type === "double" && player.cooldowns.double === 0) {
      player.cooldowns.double = 1;
      this.state.message = "Double damage primed.";
      this.audio.click();
      this.draw();
    }
  }

  submitAnswer(value) {
    if (this.state.mode !== "combat" || this.state.phase !== "player" || !this.state.problem) return;
    if (this.state.bossIntro > 0) return; // Don't accept input during boss reveal.

    const parsed = normalizeAnswer(value);
    const expected = this.state.problem.answer;
    const isCorrect = parsed !== null && parsed === expected;

    // Persist accuracy stats — counts every attempted answer.
    recordAnswer(this.save, isCorrect);

    if (isCorrect) {
      // Time bonus: faster answers => bigger multiplier.
      const elapsed = (performance.now() - this.state.answerOpenedAt) / 1000;
      const bonusFactor = clamp(1 + (this.state.player.bonusWindow - elapsed) * 0.24, 1, 2.4);
      // Combo bonus: stack 8% per consecutive correct answer.
      const comboFactor = 1 + this.state.player.combo * 0.08;
      // Double-cast bonus: 2× when "double" ability is primed.
      const doubleFactor = this.state.player.cooldowns.double > 0 ? 2 : 1;
      // Crit on very fast answers (<= 1.5s).
      const crit = elapsed <= 1.5 ? 1.35 : 1;
      // Difficulty modifier on player damage.
      const diffMod = DIFFICULTY[this.save.settings.difficulty]?.playerDmg || 1;
      const damage = Math.round(10 * this.state.player.damageMultiplier * bonusFactor * comboFactor * doubleFactor * crit * diffMod);

      this.state.enemy.hp = Math.max(0, this.state.enemy.hp - damage);
      this.state.player.combo += 1;
      // Track best combo this run.
      this.state.player.bestCombo = Math.max(this.state.player.bestCombo, this.state.player.combo);
      this.state.lastOutcome = `Correct for ${damage} damage`;
      // Pick a kid-friendly message; crit gets the loudest praise.
      this.state.message = crit > 1 ? "Critical spell strike!" : KID_PRAISE[Math.floor(Math.random() * KID_PRAISE.length)];
      this.feedbackText.textContent = `Correct! ${damage} damage dealt.`;
      this.state.floatingText.push({ text: `-${damage}`, x: 700, y: 180, color: "#7fffd4", life: 1.2 });
      this.spawnBurst(704, 190, "#7fffd4");
      // Bigger burst on crits/doubles for visual juice.
      if (crit > 1 || doubleFactor > 1) this.spawnBurst(704, 190, "#f5d98a");
      this.flashScreen("#7fffd4", crit > 1 ? 0.18 : 0.08);
      this.state.cameraShake = Math.min(this.state.cameraShake + 4 + damage * 0.05, 14);
      this.state.hitStop = 0.08; // Brief pause for impact.
      this.audio.success();
      this.state.player.cooldowns.double = 0;
      this.state.player.cooldowns.hint = 0;

      if (this.state.enemy.hp <= 0) {
        this.exitCombat(true);
        return;
      }
    } else {
      // Reset combo on wrong answer — a small, fair penalty.
      this.state.player.combo = 0;
      this.state.lastOutcome = "Wrong answer";
      this.state.message = KID_TRY_AGAIN[Math.floor(Math.random() * KID_TRY_AGAIN.length)];
      this.feedbackText.textContent = `Not quite — the answer was ${expected}.`;
      this.audio.fail();
    }

    this.state.phase = "enemy";
    this.answerInput.value = "";
    this.draw();
    window.setTimeout(() => this.enemyAct(), this.state.freezeTimer > 0 ? 1200 : 700);
  }

  enemyAct() {
    if (this.state.mode !== "combat" || !this.state.enemy) return;

    const frozen = this.state.freezeTimer > 0;
    // Frozen enemies hit at 35% of normal damage (min 2 so it still stings).
    const damage = frozen ? Math.max(2, Math.round(this.state.enemy.damage * 0.35)) : this.state.enemy.damage;
    this.state.player.hp = Math.max(0, this.state.player.hp - damage);
    this.state.cameraShake = 8;
    this.state.floatingText.push({ text: `-${damage}`, x: 190, y: 200, color: "#ff6b6b", life: 1.2 });
    this.spawnBurst(210, 210, "#ff6b6b");
    // Red flash for damage taken — instant feedback for the player.
    this.flashScreen("#ff3333", 0.18);
    this.audio.enemyAttack();

    if (this.state.player.hp <= 0) {
      this.exitCombat(false);
      return;
    }

    this.state.message = frozen ? "The enemy struggles through frozen time." : `${this.state.enemy.name} strikes back.`;
    this.rollProblem();
    this.draw();
  }

  spawnBurst(x, y, color) {
    // 16 short-lived particles in random directions — feels like a magic burst.
    for (let index = 0; index < 16; index += 1) {
      this.state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 140,
        vy: (Math.random() - 0.5) * 140,
        life: 0.4 + Math.random() * 0.35,
        color,
        size: 3 + Math.random() * 2,
      });
    }
  }

  /**
   * Trigger a brief full-screen colored flash. Used for hits, freezes, victory.
   */
  flashScreen(color, life = 0.2) {
    this.state.flash = { color, life };
  }

  // ─── 5. Update / render loop ────────────────────────────────────────────

  update(dt) {
    // Pause freezes simulation but still allows redraws (for the overlay).
    if (this.state.mode === "paused") return;
    // Hit-stop: skip simulation for a beat after a hit for visceral impact.
    if (this.state.hitStop > 0) {
      this.state.hitStop -= dt;
      return;
    }

    this.state.tick += dt;
    this.state.worldTime += dt;
    this.updateCooldowns(dt);
    this.updateParticles(dt);
    this.updateFloatingText(dt);
    this.state.cameraShake = Math.max(0, this.state.cameraShake - dt * 28);
    if (this.state.flash.life > 0) this.state.flash.life = Math.max(0, this.state.flash.life - dt * 1.6);
    if (this.state.bossIntro > 0) this.state.bossIntro = Math.max(0, this.state.bossIntro - dt);

    // Lerp the displayed HP fractions toward the real values for smooth bars.
    const targetPlayer = this.state.player.hp / this.state.player.maxHp;
    const targetEnemy = this.state.enemy ? this.state.enemy.hp / this.state.enemy.maxHp : 1;
    // Lerp factor: closer to 1 = faster catch-up. dt * 6 ≈ 100ms time-to-target.
    this.state.hpDisplay += (targetPlayer - this.state.hpDisplay) * Math.min(1, dt * 6);
    this.state.enemyHpDisplay += (targetEnemy - this.state.enemyHpDisplay) * Math.min(1, dt * 6);

    if (this.state.mode === "combat" && this.state.freezeTimer > 0) {
      this.state.freezeTimer = Math.max(0, this.state.freezeTimer - dt);
    }
  }

  updateCooldowns(dt) {
    const { cooldowns } = this.state.player;
    if (cooldowns.hint > 0) cooldowns.hint = Math.max(0, cooldowns.hint - dt * 0.3);
    if (cooldowns.double > 0 && this.state.phase !== "player") {
      cooldowns.double = Math.max(0, cooldowns.double - dt * 0.1);
    }
  }

  updateParticles(dt) {
    this.state.particles = this.state.particles.filter((particle) => {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      // Light gravity makes bursts feel grounded.
      particle.vy += 60 * dt;
      particle.life -= dt;
      return particle.life > 0;
    });
  }

  updateFloatingText(dt) {
    this.state.floatingText = this.state.floatingText.filter((item) => {
      item.y -= 30 * dt; // Float upward.
      item.life -= dt;
      return item.life > 0;
    });
  }

  draw() {
    const shakeX = this.state.cameraShake > 0 ? (Math.random() - 0.5) * this.state.cameraShake : 0;
    const shakeY = this.state.cameraShake > 0 ? (Math.random() - 0.5) * this.state.cameraShake : 0;

    this.ctx.save();
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.ctx.translate(shakeX, shakeY);

    if (this.state.mode === "title") {
      this.drawTitle();
    } else if (this.state.mode === "combat" || this.state.mode === "paused") {
      this.drawCombat();
      this.drawHud();
      if (this.state.bossIntro > 0) this.drawBossIntro();
    } else {
      this.drawGameOver();
      this.drawHud();
    }

    this.drawFx();

    // Full-screen flash overlay — drawn last so it layers above everything.
    if (this.state.flash.life > 0) {
      this.ctx.globalAlpha = this.state.flash.life * 0.6;
      this.ctx.fillStyle = this.state.flash.color;
      this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
      this.ctx.globalAlpha = 1;
    }

    this.ctx.restore();
  }

  // ─── 6. Drawing helpers ─────────────────────────────────────────────────

  drawTitle() {
    const ctx = this.ctx;
    const cx = WIDTH / 2;

    this.drawSky("forest");
    this.drawPixelMage(60, 530, 1.0);
    this.drawMonster(890, 510, { key: "dragon" }, 1.1);

    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Title card panel
    const cX = 140, cY = 38, cW = 680, cH = 460;
    ctx.fillStyle = "#05030a";
    ctx.fillRect(cX, cY, cW, cH);
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 4;
    ctx.strokeRect(cX, cY, cW, cH);
    ctx.strokeStyle = "#7a5c1a";
    ctx.lineWidth = 2;
    ctx.strokeRect(cX + 6, cY + 6, cW - 12, cH - 12);

    // Corner brackets
    const corners = [[cX+18,cY+18],[cX+cW-18,cY+18],[cX+18,cY+cH-18],[cX+cW-18,cY+cH-18]];
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 2;
    corners.forEach(([rx, ry]) => ctx.strokeRect(rx - 8, ry - 8, 16, 16));

    // Title text
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5d98a";
    ctx.font = '38px "Press Start 2P", monospace';
    ctx.fillText("PIXEL MATH", cx, cY + 78);

    ctx.fillStyle = "#7daa58";
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillText("FANTASY RPG  ·  SPELLCASTING & NUMBERS", cx, cY + 108);

    ctx.fillStyle = "#d4af37";
    ctx.fillRect(cX + 50, cY + 124, cW - 100, 3);
    ctx.fillStyle = "#7a5c1a";
    ctx.fillRect(cX + 50, cY + 129, cW - 100, 1);

    // Stats row — only show after first run so a fresh save isn't cluttered.
    if (this.save.highScore > 0) {
      ctx.font = '7px "Press Start 2P", monospace';
      ctx.fillStyle = "#f5d98a";
      ctx.fillText(`★ BEST ${this.save.highScore}   ⚔ STAGE ${this.save.bestEncounter + 1}   ✦ LVL ${this.save.bestLevel}   ✓ ${accuracyPercent(this.save)}%`, cx, cY + 152);
    }

    // Instructions table
    const rows = [
      ["SOLVE PROBLEM",  "Damage the monster"],
      ["[1] HINT",       "Simpler next problem"],
      ["[2] FREEZE",     "Slow enemy attack"],
      ["[3] DOUBLE",     "Double spell damage"],
      ["[M] MUTE",       "Toggle sound"],
      ["[P] PAUSE",      "Pause the game"],
    ];
    ctx.font = '8px "Press Start 2P", monospace';
    rows.forEach(([key, desc], i) => {
      const ry = cY + 190 + i * 32;
      ctx.fillStyle = "#d4af37";
      ctx.textAlign = "left";
      ctx.fillText(key, cX + 70, ry);
      ctx.fillStyle = "#7a6a48";
      ctx.textAlign = "right";
      ctx.fillText(desc, cX + cW - 70, ry);
      if (i < rows.length - 1) {
        ctx.fillStyle = "#1a1208";
        ctx.fillRect(cX + 50, ry + 11, cW - 100, 1);
      }
    });

    // Blinking "Press Enter"
    if (Math.floor(this.state.tick * 1.8) % 2 === 0) {
      ctx.fillStyle = "#44ff44";
      ctx.font = '13px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.fillText("PRESS  ENTER  TO  BEGIN", cx, cY + cH - 32);
    }

    ctx.textAlign = "left";
  }

  drawCombat() {
    this.drawSky(this.state.enemy?.boss ? "volcano" : "battle");
    this.drawGround(true);
    this.drawPixelMage(220, 340, 1.6);
    // Boss dragon: scale 1.4 × 1.5 = 2.1 → 269px tall, top at y≈121 (below HUD)
    // Non-boss: scale 1.6 → 205px tall, top at y≈135 (below HUD)
    const enemyY = this.state.enemy?.boss ? 390 : 340;
    const enemyScale = this.state.enemy?.boss ? 1.4 : 1.6;
    // Boss intro effect: enemy slides in from offscreen during introduction.
    let introOffsetX = 0;
    if (this.state.bossIntro > 0 && this.state.enemy?.boss) {
      const t = this.state.bossIntro / 1.6; // 1 → 0
      introOffsetX = t * 280;
    }
    this.drawMonster(700 + introOffsetX, enemyY, this.state.enemy, enemyScale);

    if (this.state.freezeTimer > 0) {
      // Subtle blue tint while freeze is active.
      this.ctx.fillStyle = "rgba(127, 255, 212, 0.08)";
      this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  drawBossIntro() {
    // "BOSS!" text that pulses during the intro window.
    const ctx = this.ctx;
    const t = this.state.bossIntro / 1.6;
    const alpha = Math.sin(t * Math.PI); // Fade in then out.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ff3a3a";
    ctx.font = 'bold 64px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.shadowColor = "#5a0a0a";
    ctx.shadowBlur = 18;
    ctx.fillText("BOSS!", WIDTH / 2, HEIGHT / 2);
    ctx.restore();
    ctx.textAlign = "left";
  }

  drawGameOver() {
    this.drawSky("volcano");
    this.drawGround(true);
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    this.ctx.fillRect(180, 100, 600, 320);

    this.ctx.fillStyle = "#ffb4b4";
    this.ctx.font = "bold 56px Courier New";
    this.ctx.fillText("GAME OVER", 300, 170);

    this.ctx.fillStyle = "#eff6ff";
    this.ctx.font = '16px "Press Start 2P", monospace';
    this.ctx.fillText(`Score: ${this.state.score}`, 360, 220);
    this.ctx.fillText(`Level reached: ${this.state.player.level}`, 280, 250);
    this.ctx.fillText(`Stage: ${this.state.encounterIndex + 1}`, 320, 280);
    this.ctx.fillText(`Best combo: ${this.state.player.bestCombo || 0}`, 280, 310);
    // Show overall accuracy (lifetime) so kids see steady improvement.
    this.ctx.fillStyle = "#7daa58";
    this.ctx.fillText(`Lifetime accuracy: ${accuracyPercent(this.save)}%`, 240, 350);

    this.ctx.fillStyle = "#44ff44";
    this.ctx.font = '13px "Press Start 2P", monospace';
    this.ctx.fillText("PRESS  ENTER  TO  TRY  AGAIN", 220, 395);
  }

  drawSky(theme) {
    let imgKey = "bg_forest";
    if (theme === "battle") imgKey = "bg_battle";
    if (theme === "volcano") imgKey = "bg_volcano";
    const img = this.ui.images[imgKey];
    if (img) this.ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
  }

  drawGround() { /* Background images cover the ground; no extra fill needed. */ }

  drawPixelMage(x, y, scale) {
    const img = this.ui.images.player;
    if (!img) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -64, -128, 128, 128);
    ctx.restore();
  }

  drawMonster(x, y, enemy, scale) {
    const key = enemy?.key || "goblin";
    const img = this.ui.images['enemy_' + key];
    if (!img) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    if (key === 'dragon') {
      ctx.scale(scale * 1.5, scale * 1.5);
    } else {
      ctx.scale(scale, scale);
    }
    ctx.drawImage(img, -64, -128, 128, 128);
    ctx.restore();
  }

  drawHud() {
    const ctx = this.ctx;
    const px = '8px "Press Start 2P", monospace';
    const pxSm = '7px "Press Start 2P", monospace';

    // Top HUD frame
    ctx.fillStyle = "#050305";
    ctx.fillRect(18, 12, WIDTH - 36, 92);
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 3;
    ctx.strokeRect(18, 12, WIDTH - 36, 92);
    ctx.strokeStyle = "#3a2a0a";
    ctx.lineWidth = 1;
    ctx.strokeRect(22, 16, WIDTH - 44, 84);

    // Player HP — uses smoothed display fraction for animated bar.
    this.drawBar(34, 30, 210, 14, this.state.hpDisplay, "hp", "HP");

    // Enemy HP (right-aligned)
    if (this.state.enemy) {
      this.drawBar(716, 30, 210, 14, this.state.enemyHpDisplay, "enemy", this.state.enemy.name.toUpperCase());
    }

    // Stats row
    ctx.font = px;
    ctx.fillStyle = "#d4af37";
    ctx.fillText(`LVL ${this.state.player.level}`, 34, 68);
    ctx.fillStyle = "#8a7a58";
    ctx.fillText(`XP ${xpToNextLevel(this.state.player)}`, 120, 68);
    ctx.fillStyle = "#44ccff";
    ctx.fillText(`COMBO ${this.state.player.combo}`, 270, 68);
    ctx.fillStyle = "#f5d98a";
    ctx.fillText(`SCORE ${this.state.score}`, 470, 68);
    // Show difficulty so kids know what they're playing.
    const diffLabel = (DIFFICULTY[this.save.settings.difficulty]?.label) || "NORMAL";
    ctx.fillStyle = "#7daa58";
    ctx.fillText(diffLabel, 680, 68);

    // Message line
    ctx.fillStyle = "#c8b890";
    ctx.font = pxSm;
    ctx.fillText(this.state.message, 34, 92);

    // Abilities bar
    const abs = [
      { label: "[1] HINT",   active: this.state.player.abilities.hint,   val: "ON" },
      { label: "[2] FREEZE", active: this.state.player.abilities.freeze,  val: String(this.state.player.freezeCharges) },
      { label: "[3] DBL",    active: this.state.player.abilities.double,  val: "ON" },
    ];
    abs.forEach((ab, i) => {
      const ax = 26 + i * 172;
      const ay = 500;
      ctx.fillStyle = ab.active ? "#0d1f08" : "#0d0d0d";
      ctx.fillRect(ax, ay, 160, 26);
      ctx.strokeStyle = ab.active ? "#4a7a32" : "#2a2a2a";
      ctx.lineWidth = 2;
      ctx.strokeRect(ax, ay, 160, 26);
      ctx.fillStyle = ab.active ? "#44ff44" : "#3a3a3a";
      ctx.font = pxSm;
      ctx.fillText(`${ab.label} ${ab.active ? ab.val : "LOCK"}`, ax + 8, ay + 17);
    });

    // Mute icon corner — quick visual reminder of current state.
    if (this.save.settings.muted) {
      ctx.fillStyle = "#ff7766";
      ctx.font = pxSm;
      ctx.fillText("MUTED", WIDTH - 80, 92);
    }

    // Pause overlay text.
    if (this.state.mode === "paused") {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "#f5d98a";
      ctx.font = '32px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", WIDTH / 2, HEIGHT / 2 - 10);
      ctx.fillStyle = "#7daa58";
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText("Press P to resume", WIDTH / 2, HEIGHT / 2 + 24);
      ctx.textAlign = "left";
    }
  }

  drawBar(x, y, width, height, fraction, type, label) {
    const ctx = this.ctx;
    // Caller now passes a precomputed (smoothed) fraction directly.
    const clamped = clamp(fraction, 0, 1);

    ctx.fillStyle = "#8a7a58";
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.fillText(label, x, y - 3);

    ctx.fillStyle = "#111";
    ctx.fillRect(x, y, width, height);

    // Segmented bar — same chiptune look as before.
    const segs = 20;
    const gap = 2;
    const segW = Math.floor((width - (segs - 1) * gap) / segs);
    const filled = Math.round(clamped * segs);

    let segColor;
    if (type === "hp") {
      // Color shifts from green→orange→red as HP drops.
      segColor = clamped < 0.25 ? "#ff2200" : clamped < 0.5 ? "#ffaa00" : "#44ff44";
    } else {
      segColor = "#ff4466";
    }

    for (let s = 0; s < segs; s++) {
      const sx = x + s * (segW + gap);
      ctx.fillStyle = s < filled ? segColor : "#222";
      ctx.fillRect(sx, y, segW, height);
    }

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    // Numeric overlay so kids know exact HP without counting bars.
    let numText = "";
    if (type === "hp") numText = `${this.state.player.hp}/${this.state.player.maxHp}`;
    else if (type === "enemy" && this.state.enemy) numText = `${this.state.enemy.hp}/${this.state.enemy.maxHp}`;
    if (numText) {
      ctx.fillStyle = "#fff";
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.textAlign = "center";
      ctx.fillText(numText, x + width / 2, y + 10);
      ctx.textAlign = "left";
    }
  }

  drawFx() {
    // Particles — small filled rects for that pixel-burst feel.
    this.state.particles.forEach((particle) => {
      this.ctx.fillStyle = particle.color;
      this.ctx.globalAlpha = clamp(particle.life, 0, 1);
      const size = particle.size || 4;
      this.ctx.fillRect(particle.x, particle.y, size, size);
      this.ctx.globalAlpha = 1;
    });

    // Floating damage numbers.
    this.state.floatingText.forEach((item) => {
      this.ctx.fillStyle = item.color;
      this.ctx.globalAlpha = clamp(item.life, 0, 1);
      this.ctx.font = "bold 18px Courier New";
      this.ctx.fillText(item.text, item.x, item.y);
      this.ctx.globalAlpha = 1;
    });
  }

  // ─── 7. UI sync + public hooks ──────────────────────────────────────────

  syncCombatUi() {
    const active = this.state.mode === "combat" || this.state.mode === "paused";
    this.combatUi.classList.toggle("hidden", !active);
    this.worldUi.classList.add("hidden");
    this.encounterButton.textContent = "Begin Quest";
    if (!active) return;
    this.problemText.textContent = this.state.problem ? `${this.state.problem.prompt} = ?` : "";
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.canvas.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  /**
   * Serialise current state to JSON for verification/automated tests.
   * Why: useful for browser-automation hooks (`window.render_game_to_text`).
   */
  renderGameToText() {
    return JSON.stringify({
      coordinateSystem: "origin top-left, x right, y down",
      mode: this.state.mode,
      phase: this.state.phase,
      difficulty: this.save.settings.difficulty,
      muted: this.save.settings.muted,
      player: {
        hp: this.state.player.hp,
        maxHp: this.state.player.maxHp,
        level: this.state.player.level,
        combo: this.state.player.combo,
        bestCombo: this.state.player.bestCombo,
        x: Math.round(this.state.player.x),
        y: Math.round(this.state.player.y),
      },
      enemy: this.state.enemy
        ? {
            name: this.state.enemy.name,
            hp: this.state.enemy.hp,
            maxHp: this.state.enemy.maxHp,
            damage: this.state.enemy.damage,
          }
        : null,
      problem: this.state.problem ? { prompt: this.state.problem.prompt, answerType: this.state.problem.type } : null,
      abilities: {
        hint: this.state.player.abilities.hint,
        freezeCharges: this.state.player.freezeCharges,
        double: this.state.player.abilities.double,
      },
      enemiesOnMap: this.state.enemiesOnMap.map((enemy) => ({
        type: enemy.type,
        x: Math.round(enemy.x),
        y: Math.round(enemy.y),
      })),
      score: this.state.score,
      message: this.state.message,
      save: {
        highScore: this.save.highScore,
        bestLevel: this.save.bestLevel,
        bestEncounter: this.save.bestEncounter,
        accuracy: accuracyPercent(this.save),
      },
    });
  }
}
