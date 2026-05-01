// main.js — boots the game: preloads images, waits for fonts, then constructs Game.
import { Game } from "./game.js";

const canvas = document.querySelector("#game");

// Map of image keys → file paths. Each `enemy_<key>.png` is referenced by
// game.js when drawing monsters, so adding a new enemy means adding a key here.
const imageSources = {
  player: "../assets/player_mage.png",
  enemy_goblin: "../assets/enemy_goblin.png",
  enemy_orc: "../assets/enemy_orc.png",
  enemy_skeleton: "../assets/enemy_skeleton.png",
  enemy_dragon: "../assets/enemy_dragon.png",
  bg_forest: "../assets/bg_forest.png",
  bg_battle: "../assets/bg_battle.png",
  bg_volcano: "../assets/bg_volcano.png",
};

// Holds loaded HTMLImageElements once their `onload` fires.
const images = {};
let imagesLoaded = 0;
let imagesErrored = 0;
const totalImages = Object.keys(imageSources).length;

/**
 * Once all images and fonts are ready, create the Game and start the RAF loop.
 * Why split out: easier to instrument or delay if we add a loading screen later.
 */
function initGame() {
  const game = new Game(canvas, {
    combatUi: document.querySelector("#combat-ui"),
    worldUi: document.querySelector("#world-ui"),
    encounterButton: document.querySelector("#encounter-button"),
    answerForm: document.querySelector("#answer-form"),
    answerInput: document.querySelector("#answer-input"),
    choiceGrid: document.querySelector("#choice-grid"),
    feedbackText: document.querySelector("#feedback-text"),
    problemText: document.querySelector("#problem-text"),
    images,
    // New UI hooks for settings, pause, and stats display.
    settingsPanel: document.querySelector(".settings-bar"),
    muteToggle: document.querySelector("#mute-toggle"),
    difficultyButtons: Array.from(document.querySelectorAll(".diff-btn")),
    pauseOverlay: document.querySelector("#pause-overlay"),
    statsDisplay: document.querySelector("#stats-display"),
  });

  // RAF main loop. We clamp dt to 33ms (~30fps min) so a tab-resume can't fire
  // a single 5s frame that destabilises physics-y values like cameraShake.
  let lastTime = performance.now();
  game.draw();

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    game.update(dt);
    game.draw();
    window.requestAnimationFrame(frame);
  }

  // Test/automation hooks — same as before, useful for browser automation.
  window.render_game_to_text = () => game.renderGameToText();
  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let index = 0; index < steps; index += 1) {
      game.update(1 / 60);
    }
    game.draw();
  };

  window.requestAnimationFrame(frame);
}

/**
 * Preload every image. We boot only after each one fires onload OR onerror so
 * a single missing asset can't keep the game stuck on a black screen.
 */
function checkAllLoaded() {
  if (imagesLoaded + imagesErrored === totalImages) {
    // Wait for the pixel font too — it's used everywhere on the canvas HUD.
    document.fonts.load('10px "Press Start 2P"').then(initGame).catch(initGame);
  }
}

for (const [key, src] of Object.entries(imageSources)) {
  const img = new Image();
  img.onload = () => {
    imagesLoaded += 1;
    checkAllLoaded();
  };
  img.onerror = () => {
    // Track errors so we still boot — the image just won't render.
    console.warn(`Failed to load image: ${src}`);
    imagesErrored += 1;
    checkAllLoaded();
  };
  img.src = src;
  images[key] = img;
}
