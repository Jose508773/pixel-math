import { AudioController } from "./audio.js";
import { FLOOR_Y, HEIGHT, TILE, WIDTH, WORLD_COLS, WORLD_ROWS } from "./config.js";
import { applyXp, makeEnemy, makePlayer, xpToNextLevel } from "./entities.js";
import { generateProblem, normalizeAnswer } from "./math.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;
    this.audio = new AudioController();

    this.state = {
      mode: "title",
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
    };

    this.keys = new Set();
    this.answerInput = ui.answerInput;
    this.problemText = ui.problemText;
    this.feedbackText = ui.feedbackText;
    this.combatUi = ui.combatUi;
    this.choiceGrid = ui.choiceGrid;
    this.worldUi = ui.worldUi;
    this.encounterButton = ui.encounterButton;

    this.bindEvents();
    this.syncCombatUi();
  }

  bindEvents() {
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }

      if (event.key.toLowerCase() === "f") {
        this.toggleFullscreen();
      }

      if (this.state.mode === "title" && event.key === "Enter") {
        this.startAdventure();
        return;
      }

      if (this.state.mode === "gameover" && event.key === "Enter") {
        this.reset();
        return;
      }

      if (this.state.mode === "combat") {
        if (event.key === "1") this.castAbility("hint");
        if (event.key === "2") this.castAbility("freeze");
        if (event.key === "3") this.castAbility("double");
      }

      this.keys.add(event.key.toLowerCase());
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.key.toLowerCase());
    });

    this.ui.answerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitAnswer(this.answerInput.value);
    });

    this.encounterButton.addEventListener("click", () => {
      if (this.state.mode === "title") {
        this.startAdventure();
      } else if (this.state.mode === "explore") {
        this.enterCombat();
      }
    });

    this.answerInput.addEventListener("focus", () => {
      this.audio.ensure();
    });
  }

  reset() {
    this.state = {
      ...this.state,
      mode: "title",
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
    };
    this.answerInput.value = "";
    this.feedbackText.textContent = "";
    this.syncCombatUi();
    this.draw();
  }

  startAdventure() {
    this.state.mode = "explore";
    this.state.message = "Find a monster and solve spells to survive.";
    this.audio.ensure();
    this.syncCombatUi();
    this.draw();
  }

  spawnWorldEnemies() {
    return Array.from({ length: 5 }, (_, index) => ({
      id: `mob-${index}-${Math.random().toString(16).slice(2, 8)}`,
      x: 470 + index * 84,
      y: 340 + (index % 2) * 28,
      type: ["goblin", "orc", "skeleton"][index % 3],
      bob: Math.random() * Math.PI * 2,
    }));
  }

  enterCombat() {
    this.state.mode = "combat";
    this.state.phase = "player";
    this.state.enemy = makeEnemy(this.state.encounterIndex);
    this.state.problem = null;
    this.state.freezeTimer = 0;
    this.state.message = `${this.state.enemy.name} blocks the path.`;
    this.state.environment = this.state.enemy.boss ? "Obsidian Gate" : "Battlefield";
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
      this.state.message = `Victory. +${xpEarned} XP earned.`;
      if (leveled) {
        this.state.message += " Level up.";
        this.audio.levelUp();
      }
      this.state.encounterIndex += 1;
      this.state.enemiesOnMap = this.spawnWorldEnemies();
      this.state.mode = "explore";
      this.state.environment = this.state.encounterIndex >= 6 ? "Frost Dungeon" : "Emerald Forest";
    } else {
      this.state.mode = "gameover";
      this.state.message = "The monsters overwhelmed you. Press Enter to try again.";
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
    this.state.problem = generateProblem(
      this.state.encounterIndex + this.state.player.level,
      enemy?.difficultyBias || 0,
      forcedSimple,
      Boolean(enemy?.boss),
    );
    this.problemText.textContent = `${this.state.problem.prompt} = ?`;
    this.renderChoices();
    this.state.answerOpenedAt = performance.now();
    this.state.phase = "player";
    this.answerInput.value = "";
    this.feedbackText.textContent = "Solve quickly for bonus damage.";
    this.draw();
  }

  buildChoices(answer) {
    const choices = new Set([answer]);
    while (choices.size < 4) {
      const spread = Math.max(2, Math.ceil(Math.abs(answer) * 0.25));
      const offset = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
      const next = Math.round((answer + offset) * 10) / 10;
      if (next !== answer) choices.add(next);
    }
    return [...choices].sort(() => Math.random() - 0.5);
  }

  renderChoices() {
    this.choiceGrid.replaceChildren();
    if (!this.state.problem) return;

    this.buildChoices(this.state.problem.answer).forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(choice);
      button.addEventListener("click", () => this.submitAnswer(choice));
      this.choiceGrid.append(button);
    });
  }

  castAbility(type) {
    const { player } = this.state;
    if (!player.abilities[type]) return;

    if (type === "hint" && player.cooldowns.hint === 0) {
      player.cooldowns.hint = 1;
      this.state.message = "Hint spell active. Next problem is simpler.";
      this.rollProblem(true);
      return;
    }

    if (type === "freeze" && player.abilities.freeze && player.freezeCharges > 0 && this.state.freezeTimer <= 0) {
      this.state.freezeTimer = 5;
      player.freezeCharges -= 1;
      this.state.message = "Time slows around the enemy.";
      this.draw();
    }

    if (type === "double" && player.cooldowns.double === 0) {
      player.cooldowns.double = 1;
      this.state.message = "Double damage primed.";
      this.draw();
    }
  }

  submitAnswer(value) {
    if (this.state.mode !== "combat" || this.state.phase !== "player" || !this.state.problem) return;

    const parsed = normalizeAnswer(value);
    const expected = this.state.problem.answer;
    const isCorrect = parsed !== null && parsed === expected;

    if (isCorrect) {
      const elapsed = (performance.now() - this.state.answerOpenedAt) / 1000;
      const bonusFactor = clamp(1 + (this.state.player.bonusWindow - elapsed) * 0.24, 1, 2.4);
      const comboFactor = 1 + this.state.player.combo * 0.08;
      const doubleFactor = this.state.player.cooldowns.double > 0 ? 2 : 1;
      const crit = elapsed <= 1.5 ? 1.35 : 1;
      const damage = Math.round(10 * this.state.player.damageMultiplier * bonusFactor * comboFactor * doubleFactor * crit);

      this.state.enemy.hp = Math.max(0, this.state.enemy.hp - damage);
      this.state.player.combo += 1;
      this.state.lastOutcome = `Correct for ${damage} damage`;
      this.state.message = crit > 1 ? "Critical spell strike." : "Spell hits true.";
      this.feedbackText.textContent = `Correct. ${damage} damage dealt.`;
      this.state.floatingText.push({ text: `-${damage}`, x: 700, y: 180, color: "#7fffd4", life: 1 });
      this.spawnBurst(704, 190, "#7fffd4");
      this.audio.success();
      this.state.player.cooldowns.double = 0;
      this.state.player.cooldowns.hint = 0;

      if (this.state.enemy.hp <= 0) {
        this.exitCombat(true);
        return;
      }
    } else {
      this.state.player.combo = 0;
      this.state.lastOutcome = "Wrong answer";
      this.state.message = "The spell fizzles.";
      this.feedbackText.textContent = `Wrong. Answer was ${expected}.`;
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
    const damage = frozen ? Math.max(2, Math.round(this.state.enemy.damage * 0.35)) : this.state.enemy.damage;
    this.state.player.hp = Math.max(0, this.state.player.hp - damage);
    this.state.cameraShake = 8;
    this.state.floatingText.push({ text: `-${damage}`, x: 190, y: 200, color: "#ff6b6b", life: 1 });
    this.spawnBurst(210, 210, "#ff6b6b");
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
    for (let index = 0; index < 16; index += 1) {
      this.state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 140,
        vy: (Math.random() - 0.5) * 140,
        life: 0.4 + Math.random() * 0.35,
        color,
      });
    }
  }

  update(dt) {
    this.state.tick += dt;
    this.state.worldTime += dt;
    this.updateCooldowns(dt);
    this.updateParticles(dt);
    this.updateFloatingText(dt);
    this.state.cameraShake = Math.max(0, this.state.cameraShake - dt * 28);

    if (this.state.mode === "explore") {
      this.updateExplore(dt);
    }

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
      particle.life -= dt;
      return particle.life > 0;
    });
  }

  updateFloatingText(dt) {
    this.state.floatingText = this.state.floatingText.filter((item) => {
      item.y -= 26 * dt;
      item.life -= dt;
      return item.life > 0;
    });
  }

  updateExplore(dt) {
    const player = this.state.player;
    const speed = 120;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) dx -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) dx += 1;
    if (this.keys.has("arrowup") || this.keys.has("w")) dy -= 1;
    if (this.keys.has("arrowdown") || this.keys.has("s")) dy += 1;

    if (dx || dy) {
      const length = Math.hypot(dx, dy) || 1;
      player.x = clamp(player.x + (dx / length) * speed * dt, 120, WIDTH - 120);
      player.y = clamp(player.y + (dy / length) * speed * dt, 190, FLOOR_Y);
      player.worldStep += dt * 8;
    }

    this.state.enemiesOnMap.forEach((enemy, index) => {
      enemy.bob += dt * (1.4 + index * 0.1);
      const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (distance < 40) {
        this.enterCombat();
      }
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
    } else if (this.state.mode === "explore") {
      this.drawWorld();
    } else if (this.state.mode === "combat") {
      this.drawCombat();
    } else {
      this.drawGameOver();
    }

    this.drawHud();
    this.drawFx();
    this.ctx.restore();
  }

  drawTitle() {
    const ctx = this.ctx;
    this.drawSky("forest");
    this.drawGround();
    this.drawPixelMage(220, 310, 1.4);
    this.drawMonster(690, 290, { key: "dragon" }, 1.8);

    ctx.fillStyle = "#eff6ff";
    ctx.font = "bold 48px Courier New";
    ctx.fillText("PIXEL MATH", 276, 128);
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 20px Courier New";
    ctx.fillText("Fantasy RPG of Spellcasting and Numbers", 182, 166);

    const lines = [
      "Move with WASD or arrow keys in the overworld.",
      "Touch monsters to enter battle.",
      "Use 1 Hint, 2 Freeze, 3 Double Damage when unlocked.",
      "Press Enter to begin.",
    ];

    ctx.font = "18px Courier New";
    lines.forEach((line, index) => {
      ctx.fillStyle = index === lines.length - 1 ? "#7fffd4" : "#dfe7fd";
      ctx.fillText(line, 170, 250 + index * 36);
    });
  }

  drawWorld() {
    this.drawSky("forest");
    this.drawGround();
    this.drawTilePath();
    this.drawWorldDecor();
    this.state.enemiesOnMap.forEach((enemy) => {
      const yOffset = Math.sin(enemy.bob) * 4;
      this.drawMonster(enemy.x, enemy.y + yOffset, this.getWorldEnemyDescriptor(enemy.type), 0.7);
    });
    this.drawPixelMage(this.state.player.x, this.state.player.y, 0.7);
  }

  drawCombat() {
    this.drawSky(this.state.enemy?.boss ? "volcano" : "battle");
    this.drawGround(true);
    this.drawPixelMage(220, 330, 1.6);
    this.drawMonster(704, 288, this.state.enemy, this.state.enemy?.boss ? 2 : 1.6);

    if (this.state.freezeTimer > 0) {
      this.ctx.fillStyle = "rgba(127, 255, 212, 0.08)";
      this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  drawGameOver() {
    this.drawSky("volcano");
    this.drawGround(true);
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    this.ctx.fillStyle = "#ffb4b4";
    this.ctx.font = "bold 56px Courier New";
    this.ctx.fillText("GAME OVER", 296, 186);
    this.ctx.fillStyle = "#eff6ff";
    this.ctx.font = "20px Courier New";
    this.ctx.fillText(`Final score: ${this.state.score}`, 362, 246);
    this.ctx.fillText("Press Enter to challenge fate again.", 254, 300);
  }

  drawSky(theme) {
    let imgKey = "bg_forest";
    if (theme === "battle") imgKey = "bg_battle";
    if (theme === "volcano") imgKey = "bg_volcano";
    const img = this.ui.images[imgKey];
    if (img) {
      this.ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    }
  }

  drawGround(combat = false) {
    // The background images already cover the ground. We don't need to draw solid color ground.
  }

  drawTilePath() {
    // Disabled to let the pixel art background shine
  }

  drawWorldDecor() {
    // Disabled to let the pixel art background shine
  }

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
    ctx.fillStyle = "rgba(6, 9, 18, 0.82)";
    ctx.fillRect(18, 14, WIDTH - 36, 78);
    ctx.strokeStyle = "#cddafd";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 14, WIDTH - 36, 78);

    this.drawBar(34, 34, 220, 16, this.state.player.hp / this.state.player.maxHp, "#ff6b6b", "Hero HP");

    if (this.state.enemy) {
      this.drawBar(706, 34, 220, 16, this.state.enemy.hp / this.state.enemy.maxHp, "#7fffd4", this.state.enemy.name);
    }

    ctx.fillStyle = "#eff6ff";
    ctx.font = "16px Courier New";
    ctx.fillText(`Lvl ${this.state.player.level}`, 34, 74);
    ctx.fillText(`XP Next ${xpToNextLevel(this.state.player)}`, 132, 74);
    ctx.fillText(`Combo ${this.state.player.combo}`, 314, 74);
    ctx.fillText(`Score ${this.state.score}`, 462, 74);
    ctx.fillText(this.state.environment, 614, 74);

    const abilityText = `1 Hint ${this.state.player.abilities.hint ? "ON" : "LOCK"}   2 Freeze ${this.state.player.abilities.freeze ? this.state.player.freezeCharges : "LOCK"}   3 Double ${this.state.player.abilities.double ? "ON" : "LOCK"}`;
    ctx.fillStyle = "#ffd166";
    ctx.font = "13px Courier New";
    ctx.fillText(abilityText, 34, 516);

    ctx.fillStyle = "#dfe7fd";
    ctx.font = "15px Courier New";
    ctx.fillText(this.state.message, 34, 106);
  }

  drawBar(x, y, width, height, pct, color, label) {
    const ctx = this.ctx;
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * clamp(pct, 0, 1), height);
    ctx.strokeStyle = "#f8fafc";
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "12px Courier New";
    ctx.fillText(label, x, y - 6);
  }

  drawFx() {
    this.state.particles.forEach((particle) => {
      this.ctx.fillStyle = particle.color;
      this.ctx.globalAlpha = clamp(particle.life, 0, 1);
      this.ctx.fillRect(particle.x, particle.y, 4, 4);
      this.ctx.globalAlpha = 1;
    });

    this.state.floatingText.forEach((item) => {
      this.ctx.fillStyle = item.color;
      this.ctx.font = "bold 18px Courier New";
      this.ctx.fillText(item.text, item.x, item.y);
    });
  }

  getWorldEnemyDescriptor(type) {
    const map = {
      goblin: { key: "goblin", palette: ["#5ac54f", "#2f8f3d", "#193c24"] },
      orc: { key: "orc", palette: ["#8cc751", "#496d31", "#1d2918"] },
      skeleton: { key: "skeleton", palette: ["#e5e7eb", "#8b9bb4", "#322f44"] },
    };
    return map[type];
  }

  syncCombatUi() {
    const active = this.state.mode === "combat";
    this.combatUi.classList.toggle("hidden", !active);
    this.worldUi.classList.toggle("hidden", active);
    this.encounterButton.textContent = this.state.mode === "title" ? "Begin Quest" : "Scout Monster";
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

  renderGameToText() {
    return JSON.stringify({
      coordinateSystem: "origin top-left, x right, y down",
      mode: this.state.mode,
      phase: this.state.phase,
      player: {
        hp: this.state.player.hp,
        maxHp: this.state.player.maxHp,
        level: this.state.player.level,
        combo: this.state.player.combo,
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
    });
  }
}
