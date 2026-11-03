// Taistelulampaat – rauhallinen laidunmusiikki (Web Audio API)
// Täysin itsenäinen syntetisoitu taustamusiikki ilman ulkoisia äänitiedostoja.

class MusicPlayer {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.volume = 0.25;
    this.timer = null;
    this.step = 0;
    this.gainNode = null;

    // Haetaan aiempi asetus muistista (oletuksena päällä)
    const saved = localStorage.getItem('tl-music-enabled');
    this.enabled = saved !== null ? saved === 'true' : true;
  }

  initContext() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.enabled ? this.volume : 0;
    this.gainNode.connect(this.ctx.destination);
  }

  // Pehmeä harppu/kantele-plukki
  playPluck(freq, time, duration = 0.8, amp = 0.15) {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, time);
    filter.frequency.exponentialRampToValueAtTime(300, time + duration);

    gain.gain.setValueAtTime(amp, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.gainNode);

    osc.start(time);
    osc.stop(time + duration);
  }

  // Pehmeä huilu/paimenpillisoundi
  playFlute(freq, time, duration = 1.2, amp = 0.1) {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    // Pieni vibrato
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 5;
    lfoGain.gain.value = 3;
    lfo.connect(osc.frequency);
    lfo.start(time);
    lfo.stop(time + duration);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(amp, time + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.gainNode);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration);
    osc2.stop(time + duration);
  }

  // Matala bassosointi
  playBass(freq, time, duration = 1.4, amp = 0.18) {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(amp, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain);
    gain.connect(this.gainNode);

    osc.start(time);
    osc.stop(time + duration);
  }

  start() {
    this.initContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.step = 0;
    this.scheduleLoop();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this.timer);
  }

  toggle() {
    this.initContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.enabled = !this.enabled;
    localStorage.setItem('tl-music-enabled', String(this.enabled));
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.1);
    }
    if (this.enabled && !this.isPlaying) {
      this.start();
    }
    return this.enabled;
  }

  scheduleLoop() {
    if (!this.isPlaying || !this.ctx) return;

    const tempo = 104; // bpm
    const beatSec = 60 / tempo;
    const now = this.ctx.currentTime + 0.05;

    // Pentatoninen G-duuriasteikko (G, A, H, D, E)
    // Nuottitaajuudet (Hz)
    const N = {
      G2: 98.0,
      C3: 130.8,
      D3: 146.8,
      E3: 164.8,
      G3: 196.0,
      A3: 220.0,
      B3: 246.9,
      C4: 261.6,
      D4: 293.7,
      E4: 329.6,
      G4: 392.0,
      A4: 440.0,
      B4: 493.9,
      D5: 587.3,
      E5: 659.3,
      G5: 784.0,
    };

    // 4 tahdin (16 iskun) lempeä paimensävelmä
    const bassline = [
      N.G2, null, N.G2, null,
      N.C3, null, N.C3, null,
      N.E3, null, N.E3, null,
      N.D3, null, N.D3, null,
    ];

    const arpeggio = [
      [N.G3, N.B3, N.D4], [N.D4], [N.G4, N.B4], [N.D4],
      [N.C4, N.E4, N.G4], [N.G4], [N.C5, N.E4], [N.G4],
      [N.E3, N.G3, N.B3], [N.E4], [N.G4, N.B4], [N.E4],
      [N.D3, N.A3, N.D4], [N.F4 || N.D4], [N.A4, N.D5], [N.A4],
    ];

    const melody = [
      N.G4, null, N.B4, N.D5,
      N.E5, null, N.D5, null,
      N.B4, N.A4, N.G4, N.E4,
      N.D4, null, N.G4, null,
    ];

    for (let i = 0; i < 16; i++) {
      const t = now + i * beatSec;
      const b = bassline[i];
      if (b) this.playBass(b, t, beatSec * 1.8, 0.16);

      const arp = arpeggio[i];
      if (arp) {
        arp.forEach((note, idx) => {
          this.playPluck(note, t + idx * 0.08, beatSec * 0.9, 0.08);
        });
      }

      const m = melody[i];
      if (m) {
        this.playFlute(m, t, beatSec * 1.4, 0.09);
      }
    }

    const loopDurationMs = 16 * beatSec * 1000;
    this.timer = setTimeout(() => this.scheduleLoop(), loopDurationMs - 150);
  }
}

export const music = new MusicPlayer();
