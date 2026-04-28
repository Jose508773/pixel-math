import { Game } from "./game.js";

const canvas = document.querySelector("#game");

const imageSources = {
  player: "../assets/player_mage.png",
  enemy_goblin: "../assets/enemy_goblin.png",
  enemy_orc: "../assets/enemy_orc.png",
  enemy_skeleton: "../assets/enemy_skeleton.png",
  enemy_dragon: "../assets/enemy_dragon.png",
  bg_forest: "../assets/bg_forest.png",
  bg_battle: "../assets/bg_battle.png",
  bg_volcano: "../assets/bg_volcano.png"
};

const images = {};
let imagesLoaded = 0;
const totalImages = Object.keys(imageSources).length;

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
    images: images
  });

  let lastTime = performance.now();
  game.draw();

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    game.update(dt);
    game.draw();
    window.requestAnimationFrame(frame);
  }

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

for (const [key, src] of Object.entries(imageSources)) {
  const img = new Image();
  img.onload = () => {
    imagesLoaded++;
    if (imagesLoaded === totalImages) {
      document.fonts.load('10px "Press Start 2P"').then(initGame).catch(initGame);
    }
  };
  img.src = src;
  images[key] = img;
}

