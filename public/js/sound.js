// ==========================================================================
// FLOOP TERMINAL — SYNTHESIZED CYBER SOUND EFFECTS
// Zero-asset Web Audio API feedback for terminal operations
// ==========================================================================

class TerminalAudio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('floop_sound_muted') === 'true';
  }

  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('floop_sound_muted', String(this.muted));
    return this.muted;
  }

  playTone(freq, type = 'sine', duration = 0.08, gain = 0.04) {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Audio autoplay policy catch
    }
  }

  // Operation sound cues
  click() {
    this.playTone(1200, 'triangle', 0.03, 0.02);
  }

  send() {
    this.playTone(880, 'sine', 0.06, 0.03);
    setTimeout(() => this.playTone(1320, 'sine', 0.08, 0.03), 40);
  }

  receive() {
    this.playTone(520, 'triangle', 0.05, 0.025);
    setTimeout(() => this.playTone(780, 'sine', 0.07, 0.03), 50);
  }

  error() {
    this.playTone(220, 'sawtooth', 0.12, 0.04);
  }

  success() {
    this.playTone(660, 'sine', 0.05, 0.03);
    setTimeout(() => this.playTone(880, 'sine', 0.05, 0.03), 50);
    setTimeout(() => this.playTone(1320, 'sine', 0.09, 0.04), 100);
  }
}

export const sound = new TerminalAudio();
