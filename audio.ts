import type { MapId, Settings } from "./types";

type V3 = { x: number; y: number; z: number };

export type WeaponSound = "ar7" | "hr9" | "lr50" | "sg12" | "pac" | "mg30" | "p4";

interface PlayOpts {
  vol?: number;
  pitch?: number;
  team?: number;
  reverb?: number;
  maxDist?: number;
  ref?: number;
}

export class AudioEngine {
  ctx!: AudioContext;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  ambBus!: GainNode;
  revSend!: GainNode;
  comp!: DynamicsCompressorNode;
  noiseW!: AudioBuffer;
  noiseP!: AudioBuffer;
  noiseB!: AudioBuffer;
  ready = false;
  settings!: Settings;
  voices = 0;
  mapReverb = 0.25;
  ambNodes: AudioNode[] = [];
  ambTimer = 0;
  ambMap: MapId = "desert";
  windGain?: GainNode;
  windFilter?: BiquadFilterNode;
  musicTimer: number | null = null;
  musicIntensity = 0.3;
  musicStep = 0;
  musicOn = false;
  nextBar = 0;
  stormLevel = 0;
  listenerPos: V3 = { x: 0, y: 0, z: 0 };
  lastStep = 0;

  init(settings: Settings) {
    this.settings = settings;
    if (this.ready) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.master = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus = c.createGain();
    this.ambBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.ambBus.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(c.destination);
    // buffers
    const len = c.sampleRate * 3;
    this.noiseW = c.createBuffer(1, len, c.sampleRate);
    this.noiseP = c.createBuffer(1, len, c.sampleRate);
    this.noiseB = c.createBuffer(1, len, c.sampleRate);
    const w = this.noiseW.getChannelData(0);
    const p = this.noiseP.getChannelData(0);
    const b = this.noiseB.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      w[i] = white;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      p[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
      last = (last + 0.02 * white) / 1.02;
      b[i] = last * 3.5;
    }
    // reverb
    const conv = c.createConvolver();
    const rl = Math.floor(c.sampleRate * 2.4);
    const ir = c.createBuffer(2, rl, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < rl; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 2.8) * (i < 400 ? i / 400 : 1);
    }
    conv.buffer = ir;
    this.revSend = c.createGain();
    this.revSend.gain.value = 1;
    const revOut = c.createGain();
    revOut.gain.value = 0.55;
    const revLP = c.createBiquadFilter();
    revLP.type = "lowpass";
    revLP.frequency.value = 3500;
    this.revSend.connect(conv);
    conv.connect(revLP);
    revLP.connect(revOut);
    revOut.connect(this.sfxBus);
    this.ready = true;
    this.applySettings(settings);
  }

  applySettings(s: Settings) {
    this.settings = s;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * 0.5, t, 0.05);
    this.ambBus.gain.setTargetAtTime(s.ambient, t, 0.05);
  }

  resume() {
    if (this.ready) this.ctx.resume();
  }

  suspend() {
    if (this.ready) this.ctx.suspend();
  }

  // ----- listener -----
  updateListener(pos: V3, yaw: number, pitch: number) {
    if (!this.ready) return;
    this.listenerPos = pos;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    }
  }

  // ----- primitives -----
  private src(buf: AudioBuffer, t0: number, dur: number, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    s.start(t0, Math.random() * 1.5);
    if (!loop) s.stop(t0 + dur + 0.05);
    return s;
  }

  private tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, out: AudioNode, atk = 0.002) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  private noise(kind: "w" | "p" | "b", ftype: BiquadFilterType, f0: number, f1: number, q: number, t0: number, dur: number, vol: number, out: AudioNode, atk = 0.002) {
    const c = this.ctx;
    const s = this.src(kind === "w" ? this.noiseW : kind === "p" ? this.noiseP : this.noiseB, t0, dur);
    const f = c.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(out);
  }

  /** build output chain. Returns {node, t0} or null if inaudible */
  private out(pos: V3 | null, o: PlayOpts = {}): { node: AudioNode; t0: number; d: number } | null {
    if (!this.ready) return null;
    const c = this.ctx;
    const now = c.currentTime;
    const vol = o.vol ?? 1;
    if (!pos) {
      const g = c.createGain();
      g.gain.value = vol;
      g.connect(this.sfxBus);
      return { node: g, t0: now, d: 0 };
    }
    const dx = pos.x - this.listenerPos.x;
    const dy = pos.y - this.listenerPos.y;
    const dz = pos.z - this.listenerPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxD = o.maxDist ?? 260;
    if (d > maxD) return null;
    if (this.voices > 46 && d > 25) return null;
    const delay = d > 30 ? Math.min(d / 343, 2.2) : 0;
    const t0 = now + delay + 0.005;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(500, 19000 / Math.pow(1 + d * 0.035, 1.25));
    const g = c.createGain();
    const ref = o.ref ?? 5;
    g.gain.value = vol * (ref / (ref + (d - 1 > 0 ? (d - 1) * 0.9 : 0)));
    let node: AudioNode;
    if (d < 1.5) {
      node = lp;
    } else {
      const p = c.createPanner();
      p.panningModel = this.settings.hrtf && d < 70 ? "HRTF" : "equalpower";
      p.distanceModel = "linear";
      p.refDistance = 1;
      p.maxDistance = 10000;
      p.rolloffFactor = 0;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      }
      lp.connect(p);
      p.connect(g);
      node = lp;
      g.connect(this.sfxBus);
      this.reverbTap(g, d, o.reverb);
      this.voices++;
      setTimeout(() => this.voices--, 900);
      return { node, t0, d };
    }
    lp.connect(g);
    g.connect(this.sfxBus);
    this.reverbTap(g, d, o.reverb);
    this.voices++;
    setTimeout(() => this.voices--, 900);
    return { node, t0, d };
  }

  private reverbTap(src: AudioNode, d: number, extra = 0) {
    const send = this.ctx.createGain();
    send.gain.value = Math.min(0.9, this.mapReverb * (0.25 + Math.min(d, 150) / 100) + extra);
    src.connect(send);
    send.connect(this.revSend);
  }

  // ----- weapons -----
  fire(w: WeaponSound, pos: V3 | null, team = 0, vol = 1) {
    const dist = pos ? 1 : 0;
    void dist;
    const o = this.out(pos, { vol: vol * (pos ? 1 : 0.9), reverb: w === "lr50" ? 0.35 : 0.05, ref: w === "lr50" || w === "hr9" ? 9 : 6, maxDist: w === "lr50" ? 420 : 300 });
    if (!o) return;
    const { node: n, t0 } = o;
    const pf = (team === 1 ? 0.82 : 1) * (0.96 + Math.random() * 0.08);
    const wave: OscillatorType = team === 1 ? "sawtooth" : "square";
    switch (w) {
      case "ar7":
        this.tone(wave, 2100 * pf, 280 * pf, t0, 0.12, 0.28, n);
        this.tone("sine", 950 * pf, 160 * pf, t0, 0.16, 0.3, n);
        this.tone("sine", 160, 55, t0, 0.1, 0.5, n);
        this.noise("w", "bandpass", 3500, 1200, 1, t0, 0.05, 0.28, n);
        break;
      case "hr9":
        this.tone("sawtooth", 1150 * pf, 62 * pf, t0, 0.26, 0.4, n);
        this.tone("square", 420 * pf, 48 * pf, t0, 0.22, 0.28, n);
        this.tone("sine", 95, 30, t0, 0.32, 0.85, n);
        this.noise("w", "lowpass", 2400, 260, 0.7, t0, 0.24, 0.5, n);
        this.noise("w", "highpass", 4000, 2000, 0.7, t0, 0.04, 0.3, n);
        break;
      case "lr50":
        this.noise("w", "highpass", 1800, 900, 0.7, t0, 0.05, 1, n);
        this.tone("sawtooth", 3400 * pf, 80, t0, 0.45, 0.5, n);
        this.tone("sine", 80, 22, t0, 0.6, 1, n);
        this.noise("w", "lowpass", 1400, 90, 0.7, t0, 0.7, 0.6, n);
        this.tone("sine", 1900 * pf, 900, t0 + 0.02, 0.5, 0.12, n);
        break;
      case "sg12":
        this.noise("w", "lowpass", 3200, 160, 0.7, t0, 0.38, 1, n);
        this.tone("sine", 115, 30, t0, 0.38, 1, n);
        this.tone("sawtooth", 700 * pf, 70, t0, 0.18, 0.45, n);
        this.noise("w", "highpass", 3000, 1500, 0.7, t0, 0.05, 0.35, n);
        // pump
        this.noise("w", "bandpass", 1800, 900, 3, t0 + 0.42, 0.05, 0.25, n);
        this.noise("w", "bandpass", 1200, 600, 3, t0 + 0.55, 0.06, 0.3, n);
        break;
      case "pac": {
        const car = this.tone("sawtooth", 1500 * pf, 640 * pf, t0, 0.09, 0.26, n);
        void car;
        const c = this.ctx;
        const mod = c.createOscillator();
        const mg = c.createGain();
        mod.frequency.value = 95;
        mg.gain.value = 600;
        mod.connect(mg);
        const o2 = c.createOscillator();
        o2.type = "square";
        o2.frequency.setValueAtTime(900 * pf, t0);
        o2.frequency.exponentialRampToValueAtTime(380 * pf, t0 + 0.08);
        mg.connect(o2.frequency);
        const g2 = c.createGain();
        g2.gain.setValueAtTime(0.0001, t0);
        g2.gain.exponentialRampToValueAtTime(0.17, t0 + 0.004);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
        o2.connect(g2);
        g2.connect(n);
        mod.start(t0);
        o2.start(t0);
        mod.stop(t0 + 0.12);
        o2.stop(t0 + 0.12);
        this.noise("w", "bandpass", 5000, 2500, 2, t0, 0.06, 0.2, n);
        this.tone("sine", 130, 60, t0, 0.09, 0.4, n);
        break;
      }
      case "mg30":
        this.tone("sawtooth", 1100 * pf, 190 * pf, t0, 0.1, 0.3, n);
        this.tone("sine", 130, 50, t0, 0.11, 0.65, n);
        this.noise("w", "bandpass", 2200, 800, 0.9, t0, 0.06, 0.32, n);
        this.noise("w", "lowpass", 1200, 200, 0.7, t0, 0.1, 0.3, n);
        break;
      case "p4":
        this.tone("sine", 2700 * pf, 520 * pf, t0, 0.1, 0.3, n);
        this.tone(wave, 1600 * pf, 420 * pf, t0, 0.07, 0.18, n);
        this.noise("w", "highpass", 5500, 3000, 0.7, t0, 0.03, 0.22, n);
        this.tone("sine", 190, 80, t0, 0.07, 0.35, n);
        break;
    }
  }

  empty(pos: V3 | null) {
    const o = this.out(pos, { vol: 0.5 });
    if (!o) return;
    this.noise("w", "bandpass", 2400, 1500, 4, o.t0, 0.03, 0.4, o.node);
  }

  reload(kind: WeaponSound, dur: number, pos: V3 | null) {
    const o = this.out(pos, { vol: pos ? 0.7 : 0.8, maxDist: 60 });
    if (!o) return;
    const { node: n, t0 } = o;
    const energy = kind === "pac";
    this.noise("w", "bandpass", 1800, 900, 4, t0 + 0.05, 0.05, 0.5, n);
    this.tone("sine", 220, 120, t0 + 0.05, 0.06, 0.3, n);
    if (energy) {
      this.tone("sawtooth", 200, 1800, t0 + dur * 0.2, dur * 0.6, 0.12, n, 0.2);
      this.tone("sine", 1800, 2400, t0 + dur * 0.85, 0.25, 0.2, n);
    } else {
      this.noise("w", "bandpass", 900, 500, 3, t0 + dur * 0.45, 0.07, 0.6, n);
      this.tone("sine", 160, 70, t0 + dur * 0.45, 0.09, 0.5, n);
      this.noise("w", "bandpass", 2600, 1800, 5, t0 + dur * 0.5, 0.04, 0.35, n);
      this.noise("w", "bandpass", 1400, 700, 4, t0 + dur * 0.82, 0.06, 0.5, n);
      this.noise("w", "bandpass", 3000, 2000, 6, t0 + dur * 0.88, 0.04, 0.4, n);
    }
  }

  switchWeapon(pos: V3 | null) {
    const o = this.out(pos, { vol: 0.6, maxDist: 40 });
    if (!o) return;
    this.noise("w", "bandpass", 700, 300, 1.5, o.t0, 0.18, 0.4, o.node, 0.05);
    this.noise("w", "bandpass", 2000, 1200, 5, o.t0 + 0.14, 0.04, 0.45, o.node);
    this.tone("sine", 140, 80, o.t0 + 0.15, 0.07, 0.3, o.node);
  }

  // ----- impacts / explosions -----
  impact(surface: string, pos: V3) {
    const o = this.out(pos, { vol: 0.7, maxDist: 90, ref: 3 });
    if (!o) return;
    const { node: n, t0 } = o;
    switch (surface) {
      case "metal":
        this.noise("w", "bandpass", 3400, 1800, 6, t0, 0.14, 0.4, n);
        this.tone("sine", 2200 + Math.random() * 900, 1400, t0, 0.2, 0.15, n);
        this.tone("triangle", 4300, 3000, t0, 0.1, 0.1, n);
        break;
      case "sand":
      case "mud":
      case "grass":
        this.noise("p", "lowpass", 1400, 300, 0.7, t0, 0.14, 0.7, n);
        this.tone("sine", 120, 60, t0, 0.1, 0.4, n);
        break;
      case "snow":
        this.noise("p", "lowpass", 2400, 600, 0.7, t0, 0.12, 0.5, n);
        break;
      case "ice":
        this.noise("w", "highpass", 4000, 2500, 1, t0, 0.1, 0.4, n);
        this.tone("sine", 3200, 1800, t0, 0.12, 0.12, n);
        break;
      case "body":
        this.noise("p", "lowpass", 900, 200, 0.7, t0, 0.1, 0.8, n);
        this.tone("sine", 150, 70, t0, 0.1, 0.5, n);
        break;
      default:
        this.noise("w", "bandpass", 2200, 700, 2, t0, 0.1, 0.55, n);
        this.tone("sine", 200, 90, t0, 0.08, 0.35, n);
    }
    if (Math.random() < 0.25 && o.d < 30) {
      const t = t0 + 0.02;
      this.tone("sine", 3500 + Math.random() * 1500, 700, t, 0.28, 0.07, n);
    }
  }

  explosion(pos: V3 | null, size = 1) {
    const o = this.out(pos, { vol: 1.3 * Math.min(1.6, size), maxDist: 900, ref: 14 * size, reverb: 0.25 });
    if (!o) return;
    const { node: n, t0, d } = o;
    const far = d > 80;
    this.noise("b", "lowpass", 2800, 70, 0.8, t0, 1.8 * size, 1.4, n, 0.004);
    this.noise("w", "lowpass", 5000, 220, 0.7, t0, 0.5 * size, 0.7, n);
    this.tone("sine", 85, 18, t0, 1.4 * size, 1.4, n);
    this.tone("sine", 55, 15, t0 + 0.04, 1.8 * size, 0.9, n);
    if (!far) {
      for (let i = 0; i < 6; i++) this.noise("w", "highpass", 3000, 1200, 1, t0 + 0.15 + Math.random() * 0.9, 0.04, 0.1 + Math.random() * 0.15, n);
      this.noise("p", "lowpass", 900, 100, 0.7, t0 + 0.3, 1.6 * size, 0.5, n, 0.3);
    }
  }

  grenadeBounce(pos: V3) {
    const o = this.out(pos, { vol: 0.6, maxDist: 60 });
    if (!o) return;
    this.noise("w", "bandpass", 2800, 1800, 7, o.t0, 0.06, 0.4, o.node);
    this.tone("sine", 1800, 900, o.t0, 0.1, 0.1, o.node);
  }
  grenadeThrow(pos: V3 | null) {
    const o = this.out(pos, { vol: 0.5, maxDist: 40 });
    if (!o) return;
    this.noise("w", "bandpass", 3000, 1200, 6, o.t0, 0.03, 0.4, o.node);
    this.noise("p", "bandpass", 500, 900, 1, o.t0 + 0.1, 0.25, 0.3, o.node, 0.06);
  }
  grenadeBeep(pos: V3) {
    const o = this.out(pos, { vol: 0.3, maxDist: 40 });
    if (!o) return;
    this.tone("sine", 2600, 2600, o.t0, 0.06, 0.2, o.node);
  }

  footstep(surface: string, run: boolean, pos: V3 | null) {
    const o = this.out(pos, { vol: (pos ? 0.45 : 0.4) * (run ? 1.3 : 0.8), maxDist: 45, ref: 2.5 });
    if (!o) return;
    const { node: n, t0 } = o;
    switch (surface) {
      case "metal":
        this.noise("w", "bandpass", 900 + Math.random() * 300, 420, 3, t0, 0.12, 0.6, n);
        this.tone("sine", 190, 100, t0, 0.1, 0.35, n);
        this.tone("triangle", 1500, 900, t0, 0.07, 0.07, n);
        break;
      case "sand":
        this.noise("p", "lowpass", 1500, 500, 0.5, t0, 0.13, 0.7, n, 0.015);
        break;
      case "snow":
        this.noise("w", "highpass", 2200, 1400, 0.7, t0, 0.14, 0.5, n, 0.02);
        this.noise("p", "lowpass", 1000, 300, 0.7, t0, 0.1, 0.3, n);
        break;
      case "mud":
      case "grass":
        this.noise("p", "lowpass", 700, 220, 1, t0, 0.15, 0.8, n, 0.02);
        this.tone("sine", 90, 55, t0, 0.1, 0.3, n);
        break;
      case "ice":
        this.noise("w", "bandpass", 2500, 1500, 3, t0, 0.07, 0.4, n);
        break;
      case "wood":
        this.noise("w", "bandpass", 500, 300, 2, t0, 0.1, 0.5, n);
        this.tone("sine", 140, 80, t0, 0.1, 0.4, n);
        break;
      default:
        this.noise("w", "bandpass", 1600, 700, 1.5, t0, 0.07, 0.5, n);
        this.tone("sine", 120, 70, t0, 0.07, 0.3, n);
    }
  }

  jump(pos: V3 | null) {
    const o = this.out(pos, { vol: 0.5, maxDist: 40 });
    if (!o) return;
    this.noise("p", "bandpass", 500, 900, 1, o.t0, 0.15, 0.3, o.node, 0.04);
  }
  land(surface: string, hard: boolean, pos: V3 | null) {
    const o = this.out(pos, { vol: hard ? 0.9 : 0.5, maxDist: 50 });
    if (!o) return;
    this.tone("sine", 110, 40, o.t0, 0.18, hard ? 0.9 : 0.5, o.node);
    this.noise("p", "lowpass", surface === "metal" ? 1800 : 900, 200, 0.7, o.t0, 0.16, 0.6, o.node);
  }

  private voice(t0: number, n: AudioNode, base: number, dur: number, vol: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base * 1.2, t0);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t0 + dur);
    const f1 = c.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.setValueAtTime(700, t0);
    f1.frequency.linearRampToValueAtTime(450, t0 + dur);
    f1.Q.value = 5;
    const f2 = c.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1500;
    f2.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f1);
    o.connect(f2);
    f1.connect(g);
    f2.connect(g);
    g.connect(n);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  hurt(pos: V3 | null, team: number) {
    const o = this.out(pos, { vol: pos ? 0.7 : 0.5, maxDist: 60 });
    if (!o) return;
    this.voice(o.t0, o.node, team === 1 ? 95 : 125, 0.22, 0.6);
    this.noise("p", "lowpass", 800, 200, 0.7, o.t0, 0.1, 0.4, o.node);
  }
  death(pos: V3 | null, team: number) {
    const o = this.out(pos, { vol: pos ? 0.85 : 0.6, maxDist: 80 });
    if (!o) return;
    this.voice(o.t0, o.node, team === 1 ? 85 : 115, 0.6, 0.7);
    this.noise("p", "lowpass", 600, 100, 0.7, o.t0 + 0.5, 0.3, 0.6, o.node);
    this.tone("sine", 100, 40, o.t0 + 0.55, 0.3, 0.4, o.node);
  }

  flyby(pos: V3, size = 1) {
    const o = this.out(pos, { vol: 1.1 * size, maxDist: 900, ref: 40, reverb: 0.2 });
    if (!o) return;
    const { node: n, t0 } = o;
    this.noise("p", "bandpass", 300, 1200, 1.2, t0, 5, 0.8, n, 2);
    this.tone("sawtooth", 60, 90, t0, 5, 0.25, n, 2);
    this.tone("sine", 45, 70, t0, 5, 0.5, n, 2);
  }

  // ----- UI -----
  ui(kind: "click" | "hover" | "hit" | "headshot" | "kill" | "capture" | "alarm" | "deploy" | "start" | "lose" | "win") {
    if (!this.ready) return;
    const o = this.out(null, { vol: 1 });
    if (!o) return;
    const { node: n, t0 } = o;
    switch (kind) {
      case "click":
        this.tone("sine", 900, 600, t0, 0.07, 0.3, n);
        this.noise("w", "bandpass", 3000, 2000, 5, t0, 0.03, 0.2, n);
        break;
      case "hover":
        this.tone("sine", 1500, 1500, t0, 0.04, 0.08, n);
        break;
      case "hit":
        this.tone("triangle", 1900, 1700, t0, 0.05, 0.35, n);
        break;
      case "headshot":
        this.tone("triangle", 2400, 2200, t0, 0.09, 0.45, n);
        this.tone("sine", 3600, 3200, t0 + 0.02, 0.16, 0.25, n);
        break;
      case "kill":
        this.tone("triangle", 1200, 1100, t0, 0.08, 0.4, n);
        this.tone("triangle", 1800, 1700, t0 + 0.07, 0.2, 0.35, n);
        break;
      case "capture":
        [523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, f, t0 + i * 0.09, 0.35, 0.3, n));
        break;
      case "alarm":
        this.tone("square", 600, 600, t0, 0.15, 0.12, n);
        this.tone("square", 450, 450, t0 + 0.2, 0.15, 0.12, n);
        break;
      case "deploy":
        this.tone("sawtooth", 100, 600, t0, 0.5, 0.2, n, 0.2);
        this.noise("p", "bandpass", 300, 3000, 1, t0, 0.6, 0.3, n, 0.3);
        break;
      case "start":
        this.tone("sine", 60, 30, t0, 1.5, 1, n);
        this.tone("sawtooth", 110, 440, t0, 1.2, 0.2, n, 0.5);
        break;
      case "lose":
        [392, 330, 262, 196].forEach((f, i) => this.tone("sawtooth", f, f * 0.98, t0 + i * 0.3, 0.6, 0.15, n));
        break;
      case "win":
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, f, t0 + i * 0.16, 0.7, 0.28, n));
        break;
    }
  }

  // ----- ambience -----
  startAmbience(map: MapId, reverb: number) {
    if (!this.ready) return;
    this.stopAmbience();
    this.ambMap = map;
    this.mapReverb = reverb;
    const c = this.ctx;
    const t = c.currentTime;
    const mkLoop = (buf: AudioBuffer) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(t, Math.random());
      this.ambNodes.push(s);
      return s;
    };
    // wind
    const wind = mkLoop(this.noiseP);
    const wf = c.createBiquadFilter();
    wf.type = "bandpass";
    wf.Q.value = map === "frozen" ? 2.2 : 0.8;
    wf.frequency.value = map === "frozen" ? 500 : map === "desert" ? 380 : map === "jungle" ? 700 : 300;
    const wg = c.createGain();
    wg.gain.value = map === "frozen" ? 0.9 : map === "desert" ? 0.7 : map === "jungle" ? 0.2 : 0.35;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = c.createGain();
    lg.gain.value = 0.35;
    lfo.connect(lg);
    lg.connect(wg.gain);
    const lfo2 = c.createOscillator();
    lfo2.frequency.value = 0.07;
    const lg2 = c.createGain();
    lg2.gain.value = 250;
    lfo2.connect(lg2);
    lg2.connect(wf.frequency);
    lfo.start();
    lfo2.start();
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(this.ambBus);
    this.windGain = wg;
    this.windFilter = wf;
    this.ambNodes.push(lfo, lfo2);
    // low rumble of distant war
    const rum = mkLoop(this.noiseB);
    const rf = c.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.value = 140;
    const rg = c.createGain();
    rg.gain.value = 0.5;
    rum.connect(rf);
    rf.connect(rg);
    rg.connect(this.ambBus);
    if (map === "industrial") {
      for (const f of [48, 72.3, 96.5]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 260;
        const g = c.createGain();
        g.gain.value = 0.06;
        const pl = c.createOscillator();
        pl.frequency.value = 0.4 + f / 200;
        const pg = c.createGain();
        pg.gain.value = 0.04;
        pl.connect(pg);
        pg.connect(g.gain);
        o.connect(lp);
        lp.connect(g);
        g.connect(this.ambBus);
        o.start();
        pl.start();
        this.ambNodes.push(o, pl);
      }
      const hiss = mkLoop(this.noiseW);
      const hf = c.createBiquadFilter();
      hf.type = "bandpass";
      hf.frequency.value = 5000;
      hf.Q.value = 0.6;
      const hg = c.createGain();
      hg.gain.value = 0.04;
      hiss.connect(hf);
      hf.connect(hg);
      hg.connect(this.ambBus);
    }
    if (map === "jungle") {
      const ins = mkLoop(this.noiseW);
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 6500;
      f.Q.value = 8;
      const g = c.createGain();
      g.gain.value = 0.05;
      const tr = c.createOscillator();
      tr.frequency.value = 38;
      const tg = c.createGain();
      tg.gain.value = 0.05;
      tr.connect(tg);
      tg.connect(g.gain);
      tr.start();
      ins.connect(f);
      f.connect(g);
      g.connect(this.ambBus);
      this.ambNodes.push(tr);
    }
    this.ambTimer = 0;
  }

  setStorm(level: number) {
    this.stormLevel = level;
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.4 + level * 1.0, this.ctx.currentTime, 1);
  }

  stopAmbience() {
    for (const n of this.ambNodes) {
      try {
        (n as any).stop?.();
      } catch {
        /* ignore */
      }
    }
    this.ambNodes = [];
    this.windGain = undefined;
  }

  /** call each frame: random distant battle sounds */
  tick(dt: number, intensity = 1) {
    if (!this.ready) return;
    this.ambTimer -= dt;
    if (this.ambTimer > 0) return;
    this.ambTimer = 0.25 + Math.random() * 1.1 / Math.max(0.2, intensity);
    const lp = this.listenerPos;
    const a = Math.random() * Math.PI * 2;
    const r = 120 + Math.random() * 180;
    const p = { x: lp.x + Math.cos(a) * r, y: lp.y + 2, z: lp.z + Math.sin(a) * r };
    const roll = Math.random();
    if (roll < 0.62) {
      const n = 2 + Math.floor(Math.random() * 6);
      const w: WeaponSound = (["ar7", "ar7", "mg30", "hr9", "pac", "p4"] as WeaponSound[])[Math.floor(Math.random() * 6)];
      const team = Math.random() < 0.5 ? 1 : 0;
      for (let i = 0; i < n; i++) setTimeout(() => this.fire(w, p, team, 0.7), i * (w === "mg30" ? 70 : 110) + Math.random() * 30);
    } else if (roll < 0.8) {
      this.explosion({ x: p.x, y: 0, z: p.z }, 1.3);
    } else if (roll < 0.86 && this.ambMap === "jungle") {
      const t = this.ctx.currentTime;
      const o = this.out(p, { vol: 0.6, maxDist: 300 });
      if (o) {
        const f = 2200 + Math.random() * 1800;
        for (let i = 0; i < 3; i++) this.tone("sine", f, f * 1.5, o.t0 + i * 0.16, 0.12, 0.15, o.node);
      }
      void t;
    } else if (roll < 0.9 && this.ambMap === "industrial") {
      const o = this.out(p, { vol: 0.9, maxDist: 300 });
      if (o) {
        this.noise("w", "bandpass", 700, 300, 8, o.t0, 0.5, 0.5, o.node);
        this.tone("sine", 220, 180, o.t0, 0.6, 0.2, o.node);
      }
    }
  }

  // ----- music -----
  startMusic(intensity = 0.3) {
    if (!this.ready || this.musicOn) {
      this.musicIntensity = intensity;
      return;
    }
    this.musicOn = true;
    this.musicIntensity = intensity;
    this.nextBar = this.ctx.currentTime + 0.1;
    this.musicStep = 0;
    const sched = () => {
      if (!this.musicOn) return;
      while (this.nextBar < this.ctx.currentTime + 1.0) {
        this.bar(this.nextBar);
        this.nextBar += 60 / (this.musicIntensity > 0.5 ? 92 : 72) * 4;
      }
    };
    sched();
    this.musicTimer = window.setInterval(sched, 300);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private bar(t0: number) {
    const c = this.ctx;
    const prog = [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ];
    const roots = [45, 41, 36, 43];
    const ch = prog[this.musicStep % 4];
    const root = roots[this.musicStep % 4];
    this.musicStep++;
    const beat = 60 / (this.musicIntensity > 0.5 ? 92 : 72);
    const len = beat * 4;
    const mf = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    // pad
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, t0);
    lp.frequency.linearRampToValueAtTime(1100 + this.musicIntensity * 1200, t0 + len * 0.6);
    lp.frequency.linearRampToValueAtTime(500, t0 + len);
    const pg = c.createGain();
    pg.gain.setValueAtTime(0.0001, t0);
    pg.gain.linearRampToValueAtTime(0.16, t0 + len * 0.4);
    pg.gain.linearRampToValueAtTime(0.0001, t0 + len + 0.5);
    lp.connect(pg);
    pg.connect(this.musicBus);
    for (const m of ch) {
      for (const det of [-6, 6]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mf(m) * (m < 60 ? 1 : 1);
        o.detune.value = det;
        o.connect(lp);
        o.start(t0);
        o.stop(t0 + len + 0.6);
      }
    }
    // sub
    this.tone("sine", mf(root), mf(root), t0, len, 0.35, this.musicBus, 0.3);
    // strings high swell
    const hg = c.createGain();
    hg.gain.setValueAtTime(0.0001, t0);
    hg.gain.linearRampToValueAtTime(0.05 * (0.4 + this.musicIntensity), t0 + len * 0.7);
    hg.gain.linearRampToValueAtTime(0.0001, t0 + len + 0.3);
    hg.connect(this.musicBus);
    for (const m of [ch[0] + 24, ch[2] + 12]) {
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = mf(m);
      o.connect(hg);
      o.start(t0);
      o.stop(t0 + len + 0.4);
    }
    // percussion
    const hits = this.musicIntensity > 0.5 ? [0, 1, 2, 2.5, 3] : [0, 2];
    for (const h of hits) {
      const t = t0 + h * beat;
      this.tone("sine", 110, 42, t, 0.5, 0.7, this.musicBus);
      this.noise("p", "lowpass", 600, 120, 0.7, t, 0.4, 0.4, this.musicBus);
    }
    if (this.musicIntensity > 0.5) {
      for (let i = 0; i < 8; i++) {
        const t = t0 + i * beat * 0.5;
        this.tone("triangle", mf(ch[i % 3] + 12), mf(ch[i % 3] + 12), t, beat * 0.4, 0.06, this.musicBus);
      }
      for (let i = 0; i < 4; i++) this.noise("w", "highpass", 7000, 6000, 1, t0 + i * beat + beat * 0.5, 0.05, 0.05, this.musicBus);
    }
  }
}

export const audio = new AudioEngine();
