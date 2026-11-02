import type { Settings } from '../game/core/settings';
import type { V3 } from '../utils/math';

/** Browsers reject pending audio-state changes when a page unloads. Nothing to do about that. */
const ignore = () => undefined;

type Listener = { position: { x: number; y: number; z: number }; right: V3 };

/** All sounds are synthesised, so there are no audio assets to go missing. */
export interface SoundLayer { freq: number; dur: number; vol: number; wave?: OscillatorType; slide?: number; delay?: number; noise?: boolean }

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambNodes: AudioNode[] = [];
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private last = new Map<string, number>();
  private active = 0;
  private settings: Settings | null = null;
  listener: Listener | null = null;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    if (!this.ctx) this.useContext(new AudioContext());
    if (this.ctx?.state === 'suspended' && this.ctx instanceof AudioContext) this.ctx.resume().catch(ignore);
  }

  /** Builds the mix graph on a context. Tests pass an OfflineAudioContext to measure what comes out. */
  useContext(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 8;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.5;
    this.master.connect(limiter);
    limiter.connect(makeup);
    makeup.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);
    const len = ctx.sampleRate * 1.5;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (this.settings) this.applySettings(this.settings);
  }

  private get audible(): boolean {
    const c = this.ctx;
    return !!c && (c.state === 'running' || (typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext));
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    this.master!.gain.value = s.masterVolume;
    this.sfx!.gain.value = s.sfxVolume;
    this.amb!.gain.value = s.ambienceVolume;
  }

  private rate(name: string, minGap: number): boolean {
    const now = this.ctx!.currentTime;
    if ((this.last.get(name) ?? -1) + minGap > now) return false;
    this.last.set(name, now);
    return true;
  }

  private spatial(gain: number, pos?: V3): { gain: number; pan: number } {
    if (!pos || !this.listener) return { gain, pan: 0 };
    const l = this.listener;
    const dx = pos.x - l.position.x;
    const dy = pos.y - l.position.y;
    const dz = pos.z - l.position.z;
    const d = Math.hypot(dx, dy, dz);
    const att = 1 / (1 + (d / 9) * (d / 9));
    const pan = d > 0.5 ? (dx * l.right.x + dz * l.right.z) / d : 0;
    return { gain: gain * att, pan: Math.max(-1, Math.min(1, pan)) * 0.75 };
  }

  private route(g: GainNode, pan: number): void {
    if (pan !== 0) {
      const p = this.ctx!.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx!);
    } else {
      g.connect(this.sfx!);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, pan = 0): void {
    const c = this.ctx!;
    if (this.active > 40) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(10, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.008, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.route(g, pan);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.active++;
    o.onended = () => { this.active--; o.disconnect(); g.disconnect(); };
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, slideTo?: number, delay = 0, pan = 0): void {
    const c = this.ctx!;
    if (this.active > 40) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const off = Math.random();
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.006, dur / 5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    this.route(g, pan);
    s.start(t, off);
    s.stop(t + dur + 0.02);
    this.active++;
    s.onended = () => { this.active--; s.disconnect(); f.disconnect(); g.disconnect(); };
  }

  playFootstep(surface: string): void {
    if (!this.audible) return;
    const k = 0.9 + Math.random() * 0.25;
    if (surface === 'concrete') {
      this.noise(0.09, 0.07, 'lowpass', 800 * k);
    } else if (surface === 'gel') {
      this.noise(0.1, 0.22, 'bandpass', 500 * k, 2);
    } else {
      this.noise(0.05, 0.06, 'bandpass', 1500 * k, 2);
      this.tone(90 * k, 0.06, 'sine', 0.09);
    }
  }

  impact(sound: string, strength: number, pos: V3): void {
    if (!this.audible || !this.rate(`i${sound}`, 0.035)) return;
    const { gain, pan } = this.spatial(Math.min(1, strength) * 0.6, pos);
    if (gain < 0.008) return;
    const k = 0.85 + Math.random() * 0.3;
    switch (sound) {
      case 'wood':
        this.tone(180 * k, 0.1, 'triangle', gain * 0.8, 90, 0, pan);
        this.noise(0.05, gain * 0.5, 'bandpass', 900 * k, 1.5, undefined, 0, pan);
        break;
      case 'metal':
        this.tone(420 * k, 0.22, 'square', gain * 0.18, 300, 0, pan);
        this.tone(1160 * k, 0.16, 'triangle', gain * 0.22, undefined, 0, pan);
        this.noise(0.04, gain * 0.4, 'highpass', 2200, 1, undefined, 0, pan);
        break;
      case 'rubber':
        this.tone(130 * k, 0.1, 'sine', gain, 70, 0, pan);
        break;
      case 'gel':
        this.tone(190 * k, 0.16, 'sine', gain * 0.9, 460, 0, pan);
        break;
      case 'ice':
        this.tone(1800 * k, 0.06, 'sine', gain * 0.3, undefined, 0, pan);
        this.noise(0.05, gain * 0.3, 'highpass', 3000, 1, undefined, 0, pan);
        break;
      case 'glass':
        this.tone(2600 * k, 0.08, 'sine', gain * 0.3, undefined, 0, pan);
        break;
      default:
        this.noise(0.1, gain * 0.9, 'lowpass', 500 * k, 1, undefined, 0, pan);
        this.tone(70 * k, 0.1, 'sine', gain * 0.7, undefined, 0, pan);
    }
  }

  private custom = new Map<string, SoundLayer[]>();

  /** A sound defined by data rather than code. */
  addSound(name: string, layers: SoundLayer[]): void {
    this.custom.set(name, layers);
  }

  removeSound(name: string): void {
    this.custom.delete(name);
  }

  /** Volume is 0..1. Position enables distance attenuation and pan. */
  play(name: string, volume = 1, pos?: V3): void {
    if (!this.audible) return;
    const { gain: v, pan: p } = this.spatial(volume, pos);
    if (v < 0.006) return;
    const rnd = 0.94 + Math.random() * 0.12;
    if (!this.rate(name, 0.025)) return;
    const custom = this.custom.get(name);
    if (custom) {
      for (const l of custom) {
        if (l.noise) this.noise(l.dur, l.vol * v, 'bandpass', l.freq, 3);
        else this.tone(l.freq, l.dur, l.wave ?? 'sine', l.vol * v, l.slide, l.delay ?? 0, p);
      }
      return;
    }
    switch (name) {
      case 'click': this.tone(1400, 0.035, 'square', 0.06 * v, 900, 0, p); this.tone(500, 0.05, 'sine', 0.12 * v, undefined, 0.01, p); break;
      case 'lever': this.noise(0.05, 0.14 * v, 'bandpass', 1500, 3); this.tone(240, 0.11, 'square', 0.05 * v, 120, 0.02); break;
      case 'uiHover': this.tone(1300, 0.025, 'sine', 0.025 * v); break;
      case 'uiClick': this.tone(740, 0.05, 'triangle', 0.09 * v, 980); break;
      case 'error': this.tone(190, 0.12, 'square', 0.07 * v); this.tone(150, 0.16, 'square', 0.07 * v, undefined, 0.1); break;
      case 'success': this.tone(620, 0.09, 'triangle', 0.14 * v); this.tone(830, 0.1, 'triangle', 0.14 * v, undefined, 0.08); this.tone(1240, 0.2, 'triangle', 0.14 * v, undefined, 0.16); break;
      case 'jump': this.noise(0.09, 0.2 * v, 'bandpass', 700, 0.8); this.tone(170, 0.08, 'sine', 0.05 * v, 240); break;
      case 'land': this.noise(0.09, 0.13 * v, 'lowpass', 400); this.tone(80, 0.1, 'sine', 0.2 * v); break;
      case 'hurt': this.tone(240, 0.16, 'sawtooth', 0.12 * v, 90); this.noise(0.08, 0.12 * v, 'lowpass', 1100); break;
      case 'bounce': this.tone(160, 0.28, 'sine', 0.3 * v, 620); break;
      case 'spring': this.tone(120, 0.26, 'triangle', 0.26 * v, 760, 0, p); this.noise(0.05, 0.1 * v, 'highpass', 2600, 1, undefined, 0, p); break;
      case 'door': this.noise(0.6, 0.09 * v, 'bandpass', 420, 2, 800, 0, p); this.tone(70, 0.5, 'sawtooth', 0.04 * v, 95, 0, p); break;
      case 'motorOn': this.tone(70, 0.5, 'sawtooth', 0.09 * v, 240, 0, p); break;
      case 'motorOff': this.tone(240, 0.5, 'sawtooth', 0.07 * v, 60, 0, p); break;
      case 'grab': this.tone(440, 0.08, 'triangle', 0.1 * v, 880); this.noise(0.06, 0.05 * v, 'highpass', 3500); break;
      case 'release': this.tone(740, 0.08, 'triangle', 0.08 * v, 370); break;
      case 'throw': this.noise(0.22, 0.2 * v, 'bandpass', 500, 1.2, 2400); this.tone(180, 0.15, 'sine', 0.18 * v, 400); break;
      case 'pin': this.tone(1000, 0.05, 'square', 0.05 * v); this.tone(680, 0.09, 'triangle', 0.1 * v, undefined, 0.04); break;
      case 'place': this.noise(0.05, 0.1 * v, 'bandpass', 1200, 2); this.tone(220, 0.09, 'triangle', 0.16 * v, 330); break;
      case 'remove': this.tone(600, 0.16, 'sawtooth', 0.05 * v, 140); this.noise(0.14, 0.05 * v, 'highpass', 1800); break;
      case 'paint': this.noise(0.14, 0.09 * v, 'highpass', 3800); break;
      case 'undo': this.tone(500, 0.07, 'triangle', 0.1 * v, 340); break;
      case 'link': this.tone(900, 0.06, 'sine', 0.1 * v, 1500); this.tone(1500, 0.06, 'sine', 0.08 * v, undefined, 0.05); break;
      case 'blaster': this.tone(1300 * rnd, 0.11, 'sawtooth', 0.08 * v, 220, 0, p); this.noise(0.04, 0.07 * v, 'highpass', 2500, 1, undefined, 0, p); break;
      case 'charge': this.tone(110, 0.12, 'sawtooth', 0.04 * v, 240); break;
      case 'impulse': this.tone(190, 0.32, 'sawtooth', 0.14 * v, 40); this.noise(0.28, 0.32 * v, 'lowpass', 2200, 1, 130); break;
      case 'freeze': this.tone(2100 * rnd, 0.1, 'sine', 0.035 * v, 2900); this.noise(0.09, 0.03 * v, 'highpass', 5000); break;
      case 'frozen': this.tone(2800, 0.3, 'sine', 0.08 * v, 900, 0, p); this.noise(0.2, 0.08 * v, 'highpass', 5200, 1, undefined, 0, p); break;
      case 'thaw': this.noise(0.18, 0.1 * v, 'highpass', 2400, 1, undefined, 0, p); break;
      case 'bouncer': this.tone(210 * rnd, 0.16, 'square', 0.1 * v, 520); this.noise(0.05, 0.08 * v, 'lowpass', 1200); break;
      case 'pop': this.tone(620, 0.09, 'sine', 0.14 * v, 150, 0, p); break;
      case 'disintegrate': this.tone(3000 * rnd, 0.1, 'sawtooth', 0.025 * v, 1300, 0, p); this.noise(0.09, 0.04 * v, 'bandpass', 3400, 4, undefined, 0, p); break;
      case 'dissolved': this.tone(900, 0.4, 'sawtooth', 0.08 * v, 60, 0, p); this.noise(0.42, 0.14 * v, 'highpass', 1400, 1, 7000, 0, p); break;
      case 'gravity': this.tone(95, 0.42, 'sine', 0.28 * v, 340); this.tone(700, 0.3, 'sine', 0.05 * v, 200); break;
      case 'well': this.tone(320, 0.9, 'sine', 0.26 * v, 40, 0, p); this.noise(0.7, 0.08 * v, 'lowpass', 500, 2, 110, 0, p); break;
      case 'reload': this.tone(420, 0.1, 'square', 0.05 * v, 760); this.tone(1100, 0.08, 'triangle', 0.08 * v, undefined, 0.22); break;
      case 'empty': this.tone(260, 0.05, 'square', 0.05 * v); break;
      case 'explode':
        this.noise(0.9, 0.7 * v, 'lowpass', 1700, 0.7, 70, 0, p);
        this.tone(95, 0.75, 'sine', 0.6 * v, 28, 0, p);
        this.noise(0.14, 0.3 * v, 'highpass', 900, 1, undefined, 0, p);
        break;
      case 'glass':
        for (let i = 0; i < 6; i++) this.tone(1900 + Math.random() * 3600, 0.09 + Math.random() * 0.2, 'sine', 0.05 * v, undefined, i * 0.018, p);
        this.noise(0.26, 0.24 * v, 'highpass', 3600, 1, undefined, 0, p);
        break;
      case 'breakWood': this.noise(0.22, 0.38 * v, 'bandpass', 800, 0.9, 300, 0, p); this.tone(130, 0.14, 'square', 0.1 * v, 60, 0, p); break;
      case 'breakStone': this.noise(0.32, 0.42 * v, 'lowpass', 900, 1, 200, 0, p); break;
      case 'breakMetal': this.tone(600, 0.3, 'square', 0.08 * v, 150, 0, p); this.noise(0.2, 0.2 * v, 'highpass', 1800, 1, undefined, 0, p); break;
      case 'npcAlert': this.tone(900, 0.1, 'square', 0.06 * v, 1300, 0, p); this.tone(1300, 0.14, 'square', 0.06 * v, undefined, 0.11, p); break;
      case 'npcHurt': this.tone(330 * rnd, 0.13, 'sawtooth', 0.09 * v, 170, 0, p); break;
      case 'npcDie': this.tone(420, 0.55, 'sawtooth', 0.11 * v, 50, 0, p); this.noise(0.26, 0.12 * v, 'lowpass', 1200, 1, undefined, 0.08, p); break;
      case 'npcTalk': for (let i = 0; i < 4; i++) this.tone(300 + Math.random() * 280, 0.07, 'triangle', 0.09 * v, undefined, i * 0.08, p); break;
      case 'creature': this.tone(650 * rnd, 0.13, 'sine', 0.16 * v, 1150, 0, p); this.tone(950 * rnd, 0.09, 'sine', 0.1 * v, 520, 0.11, p); break;
      case 'robotIdle': this.tone(150, 0.2, 'square', 0.03 * v, 180, 0, p); break;
      case 'robotShot': this.tone(900, 0.17, 'square', 0.06 * v, 180, 0, p); break;
      case 'tracer': this.noise(0.05, 0.14 * v, 'bandpass', 2400, 1.5, undefined, 0, p); this.tone(1400, 0.05, 'sawtooth', 0.04 * v, 500, 0, p); break;
      case 'slam': this.noise(0.45, 0.6 * v, 'lowpass', 700, 1, 60, 0, p); this.tone(60, 0.42, 'sine', 0.55 * v, 25, 0, p); break;
      case 'waveStart': this.tone(330, 0.22, 'sawtooth', 0.12 * v); this.tone(495, 0.26, 'sawtooth', 0.12 * v, undefined, 0.22); break;
      case 'gravityShift': this.tone(90, 1.1, 'sawtooth', 0.09 * v, 260); break;
      case 'pickup': this.tone(880, 0.07, 'sine', 0.16 * v); this.tone(1320, 0.13, 'sine', 0.14 * v, undefined, 0.06); break;
    }
  }

  setEngine(rev: number, load: number): void {
    if (!this.audible || !this.ctx) return;
    if (!this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 480;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.sfx!);
      this.engineOsc.start();
    }
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(44 + rev * 118 + load * 12, t, 0.08);
    this.engineGain!.gain.setTargetAtTime(rev === 0 && load === 0 ? 0 : 0.035 + load * 0.04, t, 0.08);
  }

  startAmbience(kind: 'indoor' | 'outdoor' | 'sky'): void {
    this.stopAmbience();
    if (!this.ctx) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    f.type = kind === 'indoor' ? 'lowpass' : 'bandpass';
    f.frequency.value = kind === 'indoor' ? 170 : kind === 'outdoor' ? 420 : 720;
    f.Q.value = 0.6;
    g.gain.value = kind === 'indoor' ? 0.11 : 0.05;
    src.connect(f);
    f.connect(g);
    g.connect(this.amb!);
    src.start();
    const nodes: AudioNode[] = [src, f, g];
    if (kind === 'indoor') {
      const hum = c.createOscillator();
      hum.frequency.value = 58;
      const hg = c.createGain();
      hg.gain.value = 0.038;
      hum.connect(hg);
      hg.connect(this.amb!);
      hum.start();
      nodes.push(hum, hg);
    } else if (kind === 'sky') {
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.09;
      const lg = c.createGain();
      lg.gain.value = 260;
      lfo.connect(lg);
      lg.connect(f.frequency);
      lfo.start();
      nodes.push(lfo, lg);
    }
    this.ambNodes = nodes;
  }

  stopAmbience(): void {
    for (const n of this.ambNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* It may not have started. */ }
      n.disconnect();
    }
    this.ambNodes = [];
    this.setEngine(0, 0);
  }

  suspend(): void {
    if (this.ctx instanceof AudioContext) this.ctx.suspend().catch(ignore);
  }

  resume(): void {
    if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') this.ctx.resume().catch(ignore);
  }

  dispose(): void {
    this.stopAmbience();
    this.engineOsc?.stop();
    if (typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext) this.ctx.close().catch(ignore);
    this.ctx = null;
  }
}
