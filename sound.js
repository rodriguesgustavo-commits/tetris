import { readSetting, writeSetting } from "./storage.js";

/**
 * Tiny WebAudio synth — no audio files, works offline.
 */
export class Sound {
  constructor() {
    this.enabled = readSetting("sound", true) !== false;
    this.ctx = null;
    this.master = null;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      try {
        this.ctx = new AudioCtor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.42;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    writeSetting("sound", this.enabled);
    if (this.enabled) {
      this.ensure();
      this.click();
    }
  }

  tone(freq, duration = 0.1, options = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const {
      type = "sine",
      gain = 0.15,
      slideTo = null,
      delay = 0,
      attack = 0.006,
    } = options;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration);
    }
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  click() {
    this.tone(620, 0.045, { type: "sine", gain: 0.045 });
  }

  move() {
    this.tone(300, 0.028, { type: "square", gain: 0.018 });
  }

  place() {
    this.tone(190, 0.09, { type: "triangle", gain: 0.17, slideTo: 116 });
    this.tone(430, 0.04, { type: "square", gain: 0.03, delay: 0.01 });
  }

  rotate() {
    this.tone(480, 0.055, { type: "triangle", gain: 0.05, slideTo: 680 });
  }

  drop() {
    this.tone(150, 0.14, { type: "sawtooth", gain: 0.1, slideTo: 54 });
    this.tone(90, 0.18, { type: "sine", gain: 0.13, slideTo: 45 });
  }

  hold() {
    this.tone(440, 0.08, { type: "sine", gain: 0.07, slideTo: 660 });
  }

  invalid() {
    this.tone(150, 0.11, { type: "square", gain: 0.045, slideTo: 92 });
  }

  clear(lines = 1, combo = 1) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    const count = Math.min(notes.length, Math.max(2, lines + 1));
    for (let i = 0; i < count; i += 1) {
      this.tone(notes[i], 0.16, {
        type: "triangle",
        gain: 0.085,
        delay: i * 0.052,
      });
    }
    if (combo > 1) {
      this.tone(880 * Math.min(combo, 3), 0.2, {
        type: "sine",
        gain: 0.055,
        delay: 0.16,
      });
    }
  }

  levelUp() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, 0.12, { type: "sine", gain: 0.07, delay: i * 0.06 });
    });
  }

  gameOver() {
    [392, 329.63, 261.63, 196].forEach((f, i) => {
      this.tone(f, 0.26, {
        type: "triangle",
        gain: 0.1,
        delay: i * 0.13,
        slideTo: f * 0.94,
      });
    });
    this.tone(98, 0.7, { type: "sine", gain: 0.08, delay: 0.35 });
  }
}