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
      type: ["goblin", "orc"][index % 2],
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
      this.drawHud();
    } else if (this.state.mode === "combat") {
      this.drawCombat();
      this.drawHud();
    } else {
      this.drawGameOver();
      this.drawHud();
    }

    this.drawFx();
    this.ctx.restore();
  }

  drawTitle() {
    const ctx = this.ctx;
    const cx = WIDTH / 2;

    // Background + sprites dimmed behind overlay
    this.drawSky("forest");
    this.drawPixelMage(60, 530, 1.0);
    this.drawMonster(890, 510, { key: "dragon" }, 1.1);

    // Dark vignette overlay
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Title card — flat pixel-art panel
    const cX = 140, cY = 48, cW = 680, cH = 428;
    ctx.fillStyle = "#05030a";
    ctx.fillRect(cX, cY, cW, cH);
    // Outer gold border
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 4;
    ctx.strokeRect(cX, cY, cW, cH);
    // Inner dark border
    ctx.strokeStyle = "#7a5c1a";
    ctx.lineWidth = 2;
    ctx.strokeRect(cX + 6, cY + 6, cW - 12, cH - 12);

    // Corner rune brackets
    const corners = [[cX+18,cY+18],[cX+cW-18,cY+18],[cX+18,cY+cH-18],[cX+cW-18,cY+cH-18]];
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 2;
    corners.forEach(([rx, ry]) => {
      ctx.strokeRect(rx - 8, ry - 8, 16, 16);
    });

    // Title text
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5d98a";
    ctx.font = '38px "Press Start 2P", monospace';
    ctx.fillText("PIXEL MATH", cx, cY + 88);

    // Subtitle
    ctx.fillStyle = "#7daa58";
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillText("FANTASY RPG  ·  SPELLCASTING & NUMBERS", cx, cY + 120);

    // Gold divider
    ctx.fillStyle = "#d4af37";
    ctx.fillRect(cX + 50, cY + 138, cW - 100, 3);
    ctx.fillStyle = "#7a5c1a";
    ctx.fillRect(cX + 50, cY + 143, cW - 100, 1);

    // Instructions table
    const rows = [
      ["WASD / ARROWS", "Move in overworld"],
      ["TOUCH MONSTER",  "Enter combat"],
      ["[1] HINT",       "Simplify next problem"],
      ["[2] FREEZE",     "Slow enemy attack"],
      ["[3] DOUBLE",     "Double spell damage"],
    ];
    ctx.font = '8px "Press Start 2P", monospace';
    rows.forEach(([key, desc], i) => {
      const ry = cY + 178 + i * 38;
      ctx.fillStyle = "#d4af37";
      ctx.textAlign = "left";
      ctx.fillText(key, cX + 70, ry);
      ctx.fillStyle = "#7a6a48";
      ctx.textAlign = "right";
      ctx.fillText(desc, cX + cW - 70, ry);
      if (i < rows.length - 1) {
        ctx.fillStyle = "#1a1208";
        ctx.fillRect(cX + 50, ry + 14, cW - 100, 1);
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
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    this.ctx.fillRect(200, 120, 560, 240);

    this.ctx.fillStyle = "#ffb4b4";
    this.ctx.font = "bold 56px Courier New";
    this.ctx.fillText("GAME OVER", 316, 186);
    this.ctx.fillStyle = "#eff6ff";
    this.ctx.font = "20px Courier New";
    this.ctx.fillText(`Final score: ${this.state.score}`, 382, 246);
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
    const px = '8px "Press Start 2P", monospace';
    const pxSm = '7px "Press Start 2P", monospace';

    // Top HUD bar
    ctx.fillStyle = "#050305";
    ctx.fillRect(18, 12, WIDTH - 36, 92);
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 3;
    ctx.strokeRect(18, 12, WIDTH - 36, 92);
    ctx.strokeStyle = "#3a2a0a";
    ctx.lineWidth = 1;
    ctx.strokeRect(22, 16, WIDTH - 44, 84);

    // Player HP bar
    this.drawBar(34, 30, 210, 14, this.state.player.hp / this.state.player.maxHp, "hp", "HP");

    // Enemy HP bar (right-aligned)
    if (this.state.enemy) {
      this.drawBar(716, 30, 210, 14, this.state.enemy.hp / this.state.enemy.maxHp, "enemy", this.state.enemy.name.toUpperCase());
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
    ctx.fillStyle = "#7daa58";
    ctx.fillText(this.state.environment.toUpperCase().slice(0, 14), 680, 68);

    // Message line
    ctx.fillStyle = "#c8b890";
    ctx.font = pxSm;
    ctx.fillText(this.state.message, 34, 92);

    // Abilities bar — flat pixel tiles
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
  }

  drawBar(x, y, width, height, type, label) {
    const ctx = this.ctx;
    const pct = type === "hp"
      ? this.state.player.hp / this.state.player.maxHp
      : type === "enemy"
        ? this.state.enemy.hp / this.state.enemy.maxHp
        : clamp(type, 0, 1);
    const clamped = clamp(pct, 0, 1);

    // Label
    ctx.fillStyle = "#8a7a58";
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.fillText(label, x, y - 3);

    // Background
    ctx.fillStyle = "#111";
    ctx.fillRect(x, y, width, height);

    // Segmented fill
    const segs = 20;
    const gap = 2;
    const segW = Math.floor((width - (segs - 1) * gap) / segs);
    const filled = Math.round(clamped * segs);

    let segColor;
    if (type === "hp") {
      segColor = clamped < 0.25 ? "#ff2200" : clamped < 0.5 ? "#ffaa00" : "#44ff44";
    } else {
      segColor = "#ff4466";
    }

    for (let s = 0; s < segs; s++) {
      const sx = x + s * (segW + gap);
      ctx.fillStyle = s < filled ? segColor : "#222";
      ctx.fillRect(sx, y, segW, height);
    }

    // Outer border
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
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
