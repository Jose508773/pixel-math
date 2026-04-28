export class AudioController {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.context) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        this.enabled = false;
        return null;
      }
      this.context = new AudioCtx();
    }
    if (this.context.state === "suspended") {
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  playTone(frequency, duration, type = "square", volume = 0.06, sweep = 0) {
    const context = this.ensure();
    if (!context) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (sweep) {
      oscillator.frequency.linearRampToValueAtTime(frequency + sweep, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  success() {
    this.playTone(660, 0.12, "square", 0.08, 120);
    this.playTone(880, 0.18, "triangle", 0.05, -80);
  }

  fail() {
    this.playTone(240, 0.16, "sawtooth", 0.07, -90);
  }

  levelUp() {
    this.playTone(520, 0.12, "triangle", 0.06, 50);
    this.playTone(780, 0.18, "triangle", 0.06, 70);
    this.playTone(1040, 0.24, "triangle", 0.05, 0);
  }

  enemyAttack() {
    this.playTone(180, 0.1, "square", 0.07, -20);
  }
}
