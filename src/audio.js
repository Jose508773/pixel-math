// audio.js — tiny synth that plays chiptune SFX via Web Audio.
// Why we synthesise instead of loading WAVs: zero asset weight, no licensing,
// and the chiptune square/triangle tones fit the pixel-art aesthetic.
export class AudioController {
  constructor() {
    // AudioContext is created lazily on first user gesture (browser policy).
    this.context = null;
    // `enabled` covers fatal cases (no Web Audio API at all).
    this.enabled = true;
    // `muted` is the user-controlled toggle, persisted via save.js.
    this.muted = false;
  }

  /**
   * Lazily creates / resumes the AudioContext.
   * Browsers require a user gesture to start audio — we call this on first
   * keydown and form focus so we don't get blocked.
   */
  ensure() {
    if (!this.enabled || this.muted) return null;
    if (!this.context) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        // Browser doesn't support Web Audio at all — disable for the session.
        this.enabled = false;
        return null;
      }
      this.context = new AudioCtx();
    }
    if (this.context.state === "suspended") {
      // Try to resume (user gesture should have just fired).
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  /**
   * User-facing mute setter. We don't tear down the context — we just gate
   * playback so unmuting is instant.
   */
  setMuted(value) {
    this.muted = Boolean(value);
  }

  /**
   * Plays a single oscillator tone with optional pitch sweep.
   * Why exposed: each SFX method below is just a flavoured combination of these.
   */
  playTone(frequency, duration, type = "square", volume = 0.06, sweep = 0) {
    const context = this.ensure();
    if (!context) return; // No context => muted or unsupported; bail silently.

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    // Set oscillator type ("square" = chiptune classic, "triangle" = soft).
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (sweep) {
      // Linear ramp gives glissando effect — used for "rising" success tones.
      oscillator.frequency.linearRampToValueAtTime(frequency + sweep, now + duration);
    }

    // Attack-decay envelope: ramp up gain quickly, then exponentially down.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  // ─── Named SFX presets ───────────────────────────────────────────────────

  success() {
    // Rising two-note chime — feels like a positive "ding".
    this.playTone(660, 0.12, "square", 0.08, 120);
    this.playTone(880, 0.18, "triangle", 0.05, -80);
  }

  fail() {
    // Single low buzz — sounds wrong but isn't shaming.
    this.playTone(240, 0.16, "sawtooth", 0.07, -90);
  }

  levelUp() {
    // Three rising tones for a celebratory arpeggio.
    this.playTone(520, 0.12, "triangle", 0.06, 50);
    this.playTone(780, 0.18, "triangle", 0.06, 70);
    this.playTone(1040, 0.24, "triangle", 0.05, 0);
  }

  enemyAttack() {
    // Low thudding tone for monster strike.
    this.playTone(180, 0.1, "square", 0.07, -20);
  }

  click() {
    // Soft tick for menu navigation.
    this.playTone(520, 0.04, "square", 0.04, 0);
  }

  victory() {
    // Bigger fanfare for boss/encounter wins.
    this.playTone(523, 0.1, "triangle", 0.07);   // C5
    this.playTone(659, 0.1, "triangle", 0.07);   // E5
    this.playTone(784, 0.18, "triangle", 0.07);  // G5
    this.playTone(1047, 0.28, "triangle", 0.06); // C6
  }
}
