import * as THREE from "three";

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export type PatternKind = "none" | "panels" | "blocks" | "tread" | "grating" | "corrug" | "planks" | "bricks";

export interface TexRecipe {
  colors: [string, string, string];
  scale: number; // lattice cells across texture
  aniso?: number; // y-scale multiplier
  oct: number;
  bump: number;
  rough: [number, number];
  metal?: number;
  pattern?: PatternKind;
  patternCount?: number;
  grime?: number;
  scratches?: number;
  rust?: number;
  overlay?: (g: CanvasRenderingContext2D, n: number) => void;
  ridged?: boolean;
  seed?: number;
}

export interface PBR {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  orm: THREE.DataTexture;
}

function noiseField(N: number, sx: number, sy: number, oct: number, seed: number, ridged = false) {
  const out = new Float32Array(N * N);
  let amp = 1;
  let total = 0;
  const rnd = mulberry32(seed);
  for (let o = 0; o < oct; o++) {
    const px = Math.max(1, Math.round(sx * Math.pow(2, o)));
    const py = Math.max(1, Math.round(sy * Math.pow(2, o)));
    const lat = new Float32Array(px * py);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * py;
      const yi = Math.floor(fy);
      const ty = fy - yi;
      const sty = ty * ty * (3 - 2 * ty);
      const y0 = yi % py;
      const y1 = (yi + 1) % py;
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * px;
        const xi = Math.floor(fx);
        const tx = fx - xi;
        const stx = tx * tx * (3 - 2 * tx);
        const x0 = xi % px;
        const x1 = (xi + 1) % px;
        const a = lat[y0 * px + x0] + (lat[y0 * px + x1] - lat[y0 * px + x0]) * stx;
        const b = lat[y1 * px + x0] + (lat[y1 * px + x1] - lat[y1 * px + x0]) * stx;
        let v = a + (b - a) * sty;
        if (ridged) v = 1 - Math.abs(v * 2 - 1);
        out[y * N + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function drawPattern(kind: PatternKind, N: number, count: number, seed: number): Float32Array | null {
  if (kind === "none") return null;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const rnd = mulberry32(seed + 77);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, N, N);
  const line = Math.max(2, N / 170);
  if (kind === "panels") {
    const n = count || 2;
    const s = N / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 110 + rnd() * 40;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(i * s, j * s, s, s);
      }
    g.strokeStyle = "#101010";
    g.lineWidth = line * 1.6;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, N);
      g.moveTo(0, i * s);
      g.lineTo(N, i * s);
      g.stroke();
    }
    g.strokeStyle = "#d0d0d0";
    g.lineWidth = line * 0.6;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.strokeRect(i * s + line * 2.2, j * s + line * 2.2, s - line * 4.4, s - line * 4.4);
      }
    g.fillStyle = "#f0f0f0";
    const r = Math.max(1.5, N / 200);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (const [ox, oy] of [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.1, 0.9],
          [0.9, 0.9],
          [0.5, 0.08],
          [0.5, 0.92],
        ]) {
          g.beginPath();
          g.arc(i * s + ox * s, j * s + oy * s, r, 0, 7);
          g.fill();
        }
    // vents
    g.fillStyle = "#202020";
    for (let k = 0; k < n; k++) {
      const x = rnd() * (N - 60);
      const y = rnd() * (N - 40);
      for (let l = 0; l < 5; l++) g.fillRect(x, y + l * (N / 90), N / 14, N / 220);
    }
  } else if (kind === "blocks" || kind === "bricks") {
    const rows = count || (kind === "bricks" ? 16 : 6);
    const h = N / rows;
    for (let r = 0; r < rows; r++) {
      const cols = kind === "bricks" ? 6 : 3 + Math.floor(rnd() * 2);
      let x = -(rnd() * h * 2);
      const bw = N / cols;
      while (x < N) {
        const v = 100 + rnd() * 70;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, r * h, bw, h);
        g.strokeStyle = "#101010";
        g.lineWidth = line * 1.8;
        g.strokeRect(x, r * h, bw, h);
        // chips
        for (let k = 0; k < 3; k++) {
          g.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.3})`;
          g.fillRect(x + rnd() * bw, r * h + rnd() * h, rnd() * 12 + 3, rnd() * 8 + 2);
        }
        x += bw;
      }
    }
  } else if (kind === "tread") {
    g.fillStyle = "#606060";
    g.fillRect(0, 0, N, N);
    const n = count || 8;
    const s = N / n;
    g.fillStyle = "#ffffff";
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.save();
        g.translate(i * s + s / 2, j * s + s / 2);
        g.rotate(((i + j) % 2 ? 1 : -1) * 0.7);
        g.beginPath();
        g.ellipse(0, 0, s * 0.38, s * 0.1, 0, 0, 7);
        g.fill();
        g.restore();
      }
  } else if (kind === "grating") {
    g.fillStyle = "#101010";
    g.fillRect(0, 0, N, N);
    const n = count || 16;
    const s = N / n;
    g.fillStyle = "#c8c8c8";
    for (let i = 0; i < n; i++) {
      g.fillRect(i * s, 0, s * 0.25, N);
      g.fillRect(0, i * s, N, s * 0.15);
    }
  } else if (kind === "corrug") {
    const n = count || 20;
    for (let x = 0; x < N; x++) {
      const v = 128 + Math.sin((x / N) * n * Math.PI * 2) * 80;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, 1, N);
    }
    g.fillStyle = "#101010";
    g.fillRect(0, N * 0.5 - 2, N, 4);
  } else if (kind === "planks") {
    const n = count || 8;
    const s = N / n;
    for (let i = 0; i < n; i++) {
      const v = 100 + rnd() * 60;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, i * s, N, s);
      g.strokeStyle = "#000";
      g.lineWidth = line * 1.5;
      g.beginPath();
      g.moveTo(0, i * s);
      g.lineTo(N, i * s);
      g.stroke();
      const jx = rnd() * N;
      g.beginPath();
      g.moveTo(jx, i * s);
      g.lineTo(jx, (i + 1) * s);
      g.stroke();
    }
  }
  const d = g.getImageData(0, 0, N, N).data;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[(N - 1 - y) * N + x] = d[(y * N + x) * 4] / 255;
  return out;
}

const cache = new Map<string, PBR>();

export function makePBR(name: string, r: TexRecipe, N: number): PBR {
  const key = name + N;
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = r.seed ?? name.split("").reduce((a, c) => a + c.charCodeAt(0) * 31, 7);
  const an = r.aniso ?? 1;
  const base = noiseField(N, r.scale, Math.max(1, r.scale * an), r.oct, seed, r.ridged);
  const fine = noiseField(N, r.scale * 4, Math.max(1, r.scale * 4 * an), 3, seed + 5);
  const grimeF = noiseField(N, 3, 6, 4, seed + 9);
  const pat = drawPattern(r.pattern || "none", N, r.patternCount || 0, seed);
  const rnd = mulberry32(seed + 3);
  const cols = r.colors.map(hex);
  const height = new Float32Array(N * N);
  for (let i = 0; i < height.length; i++) {
    height[i] = base[i] * 0.55 + fine[i] * 0.3 + (pat ? (pat[i] - 0.5) * 1.6 : 0);
  }
  // scratches
  const scr = r.scratches ?? 0;
  const scratchMask = new Float32Array(N * N);
  if (scr > 0) {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d")!;
    g.strokeStyle = "#fff";
    for (let i = 0; i < scr * 40; i++) {
      g.lineWidth = rnd() * 1.4 + 0.3;
      g.globalAlpha = rnd() * 0.7 + 0.2;
      const x = rnd() * N;
      const y = rnd() * N;
      const a = rnd() * 6.28;
      const l = rnd() * N * 0.12 + 6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    const d = g.getImageData(0, 0, N, N).data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) scratchMask[(N - 1 - y) * N + x] = d[(y * N + x) * 4 + 3] / 255;
  }
  const colData = new Uint8Array(N * N * 4);
  const nrmData = new Uint8Array(N * N * 4);
  const ormData = new Uint8Array(N * N * 4);
  const grime = r.grime ?? 0.3;
  const rust = r.rust ?? 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const t = base[i];
      let c0: RGB;
      let c1: RGB;
      let tt: number;
      if (t < 0.5) {
        c0 = cols[0];
        c1 = cols[1];
        tt = t * 2;
      } else {
        c0 = cols[1];
        c1 = cols[2];
        tt = (t - 0.5) * 2;
      }
      tt = Math.min(1, Math.max(0, (tt - 0.5) * 1.4 + 0.5));
      let cr = c0[0] + (c1[0] - c0[0]) * tt;
      let cg = c0[1] + (c1[1] - c0[1]) * tt;
      let cb = c0[2] + (c1[2] - c0[2]) * tt;
      let br = 0.82 + (fine[i] - 0.5) * 0.7;
      if (pat) br *= 0.65 + pat[i] * 0.7;
      const gr = Math.max(0, grimeF[i] - 0.45) * 2 * grime;
      br *= 1 - gr * 0.6;
      const sc = scratchMask[i];
      // rust patches
      let rustAmt = 0;
      if (rust > 0) {
        rustAmt = Math.max(0, Math.min(1, (grimeF[(i * 7) % (N * N)] * 0.5 + fine[i] * 0.5 - (1 - rust) * 0.7) * 3));
        cr += (150 - cr) * rustAmt * 0.7;
        cg += (72 - cg) * rustAmt * 0.7;
        cb += (35 - cb) * rustAmt * 0.7;
      }
      cr = cr * br + sc * 55;
      cg = cg * br + sc * 55;
      cb = cb * br + sc * 55;
      colData[i * 4] = Math.max(0, Math.min(255, cr));
      colData[i * 4 + 1] = Math.max(0, Math.min(255, cg));
      colData[i * 4 + 2] = Math.max(0, Math.min(255, cb));
      colData[i * 4 + 3] = 255;
      // normal
      const xm = y * N + ((x - 1 + N) % N);
      const xp = y * N + ((x + 1) % N);
      const ym = ((y - 1 + N) % N) * N + x;
      const yp = ((y + 1) % N) * N + x;
      const dx = (height[xp] - height[xm]) * r.bump * 6;
      const dy = (height[yp] - height[ym]) * r.bump * 6;
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      nrmData[i * 4] = ((-dx / l) * 0.5 + 0.5) * 255;
      nrmData[i * 4 + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      nrmData[i * 4 + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      nrmData[i * 4 + 3] = 255;
      // orm
      let rough = r.rough[0] + (r.rough[1] - r.rough[0]) * (fine[i] * 0.6 + gr * 0.8 + (1 - br) * 0.3);
      rough = rough - sc * 0.25 + rustAmt * 0.3;
      let metal = (r.metal ?? 0) * (1 - rustAmt * 0.9) * (1 - gr * 0.5);
      metal = Math.min(1, metal + sc * 0.2 * (r.metal ?? 0));
      ormData[i * 4] = 255;
      ormData[i * 4 + 1] = Math.max(0, Math.min(255, rough * 255));
      ormData[i * 4 + 2] = Math.max(0, Math.min(255, metal * 255));
      ormData[i * 4 + 3] = 255;
    }
  }
  // overlay (custom drawing)
  if (r.overlay) {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d")!;
    r.overlay(g, N);
    const d = g.getImageData(0, 0, N, N).data;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const s = (y * N + x) * 4;
        const o = ((N - 1 - y) * N + x) * 4;
        const a = d[s + 3] / 255;
        if (a > 0) {
          const shade = 0.75 + fine[(N - 1 - y) * N + x] * 0.5;
          for (let k = 0; k < 3; k++) colData[o + k] = colData[o + k] * (1 - a) + d[s + k] * shade * a;
        }
      }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const out = { map: mk(colData, true), normalMap: mk(nrmData, false), orm: mk(ormData, false) };
  cache.set(key, out);
  return out;
}

export const RECIPES: Record<string, TexRecipe> = {
  sand: { colors: ["#b58a55", "#d2a96e", "#e6c48a"], scale: 6, oct: 5, bump: 0.6, rough: [0.85, 1], grime: 0.1, ridged: false },
  sandRipple: { colors: ["#a87b48", "#c99d60", "#dfba7d"], scale: 4, aniso: 8, oct: 4, bump: 1.2, rough: [0.85, 1] },
  rock: { colors: ["#4a3b30", "#7d6552", "#a28a72"], scale: 4, aniso: 3, oct: 6, bump: 2.2, rough: [0.7, 1], grime: 0.4, ridged: true },
  rockDark: { colors: ["#262626", "#3d3a38", "#5c5750"], scale: 5, oct: 6, bump: 2.4, rough: [0.65, 0.95], ridged: true, grime: 0.5 },
  rockStrata: { colors: ["#6b4a35", "#a06b46", "#c99b6d"], scale: 3, aniso: 10, oct: 6, bump: 1.8, rough: [0.8, 1], grime: 0.3 },
  concrete: { colors: ["#6b6a66", "#8e8c86", "#a8a59d"], scale: 6, oct: 6, bump: 0.9, rough: [0.7, 0.95], grime: 0.7, pattern: "panels", patternCount: 2, scratches: 0.4 },
  concreteRaw: { colors: ["#55544f", "#7a7871", "#9c9992"], scale: 8, oct: 6, bump: 0.8, rough: [0.75, 1], grime: 0.8, scratches: 0.3 },
  metal: { colors: ["#4d5358", "#6c737a", "#8a9299"], scale: 5, oct: 4, bump: 0.8, rough: [0.35, 0.7], metal: 0.9, pattern: "panels", patternCount: 2, scratches: 1, grime: 0.5 },
  metalRust: { colors: ["#4a4038", "#665a4d", "#7d7266"], scale: 5, oct: 5, bump: 1, rough: [0.5, 0.9], metal: 0.85, pattern: "panels", patternCount: 3, rust: 0.7, scratches: 0.6, grime: 0.8 },
  darkMetal: { colors: ["#17191c", "#262a2f", "#3a4047"], scale: 6, oct: 4, bump: 0.8, rough: [0.3, 0.65], metal: 0.95, pattern: "panels", patternCount: 4, scratches: 1, grime: 0.4 },
  burnt: { colors: ["#0e0d0c", "#1b1917", "#2d2924"], scale: 5, oct: 6, bump: 1.2, rough: [0.6, 0.95], metal: 0.5, pattern: "panels", patternCount: 2, grime: 0.9, rust: 0.2 },
  corrug: { colors: ["#6a7076", "#8d949a", "#a9afb3"], scale: 3, oct: 3, bump: 1.2, rough: [0.4, 0.7], metal: 0.85, pattern: "corrug", patternCount: 16, grime: 0.6, rust: 0.2 },
  corrugRust: { colors: ["#5b5148", "#7a6a5a", "#8e7c68"], scale: 3, oct: 4, bump: 1.2, rough: [0.5, 0.9], metal: 0.8, pattern: "corrug", patternCount: 16, grime: 0.9, rust: 0.8 },
  tread: { colors: ["#505458", "#6e7378", "#8a8f94"], scale: 4, oct: 3, bump: 1.4, rough: [0.4, 0.7], metal: 0.9, pattern: "tread", patternCount: 10, grime: 0.7 },
  grating: { colors: ["#3a3d40", "#555a5e", "#6f7479"], scale: 3, oct: 3, bump: 2, rough: [0.4, 0.7], metal: 0.9, pattern: "grating", patternCount: 24, grime: 0.5 },
  asphalt: { colors: ["#1e1e20", "#2c2c2e", "#3d3d3f"], scale: 10, oct: 6, bump: 1.2, rough: [0.8, 1], grime: 0.6, scratches: 0.2 },
  mud: { colors: ["#2b2118", "#44352a", "#5d4a39"], scale: 5, oct: 6, bump: 1.4, rough: [0.35, 0.8], grime: 0.4 },
  grass: { colors: ["#1f3513", "#35561c", "#587a2b"], scale: 8, oct: 6, bump: 1.0, rough: [0.8, 1], grime: 0.3 },
  jungleFloor: { colors: ["#1e2a12", "#3b3a1e", "#4f5a28"], scale: 7, oct: 6, bump: 1.3, rough: [0.75, 1], grime: 0.6 },
  bark: { colors: ["#2a1d14", "#45301f", "#6b4e34"], scale: 3, aniso: 10, oct: 6, bump: 2.4, rough: [0.8, 1], grime: 0.5, ridged: true },
  stoneMoss: { colors: ["#3c4a2f", "#64705a", "#8b9680"], scale: 4, oct: 6, bump: 2, rough: [0.8, 1], grime: 0.9, pattern: "blocks", patternCount: 6, ridged: true },
  wood: { colors: ["#4c3521", "#6a4a2e", "#876340"], scale: 3, aniso: 6, oct: 5, bump: 1, rough: [0.6, 0.9], pattern: "planks", patternCount: 8, grime: 0.6 },
  snow: { colors: ["#c5d0dc", "#dde6ef", "#f4f8fc"], scale: 6, oct: 5, bump: 0.5, rough: [0.45, 0.8], grime: 0 },
  snowRough: { colors: ["#a9b7c7", "#cdd8e4", "#eaf1f8"], scale: 9, oct: 6, bump: 1.1, rough: [0.5, 0.85], grime: 0.15 },
  ice: { colors: ["#7fa8c4", "#a8cfe6", "#d8f0fb"], scale: 3, oct: 5, bump: 1.2, rough: [0.04, 0.2], ridged: true, grime: 0 },
  iceCliff: { colors: ["#5f8cab", "#8bbad4", "#c4e4f3"], scale: 3, aniso: 6, oct: 6, bump: 2, rough: [0.1, 0.35], ridged: true },
  whitePanel: { colors: ["#aab2ba", "#c9d0d6", "#e3e8ec"], scale: 4, oct: 4, bump: 0.8, rough: [0.4, 0.75], metal: 0.4, pattern: "panels", patternCount: 3, grime: 0.7, scratches: 0.6 },
  hazard: {
    colors: ["#222", "#2a2a2a", "#343434"],
    scale: 4,
    oct: 4,
    bump: 0.6,
    rough: [0.5, 0.85],
    metal: 0.6,
    grime: 0.7,
    scratches: 0.8,
    overlay: (g, n) => {
      g.fillStyle = "#e0a512";
      for (let i = -n; i < n * 2; i += n / 6) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + n / 12, 0);
        g.lineTo(i + n / 12 - n, n);
        g.lineTo(i - n, n);
        g.fill();
      }
    },
  },
  camoGreen: { colors: ["#3a4430", "#4f5a3f", "#667353"], scale: 4, oct: 5, bump: 0.6, rough: [0.55, 0.85], metal: 0.4, pattern: "panels", patternCount: 3, grime: 0.7, scratches: 0.7 },
  fabric: { colors: ["#6a5f45", "#857a5c", "#9c9170"], scale: 12, oct: 4, bump: 1, rough: [0.9, 1], grime: 0.5 },
  waterNormal: { colors: ["#0f3a40", "#165560", "#1f7380"], scale: 5, oct: 5, bump: 2.2, rough: [0.02, 0.1], ridged: true },
  armorBlue: { colors: ["#cfd6de", "#e8edf2", "#ffffff"], scale: 6, oct: 4, bump: 0.5, rough: [0.3, 0.55], metal: 0.15, scratches: 1.2, grime: 0.5 },
  armorRed: { colors: ["#2a2a2e", "#3a3a40", "#4c4c54"], scale: 6, oct: 4, bump: 0.5, rough: [0.3, 0.55], metal: 0.35, scratches: 1.2, grime: 0.5 },
};

export function getPBR(name: string, N: number) {
  const r = RECIPES[name];
  if (!r) throw new Error("recipe " + name);
  return makePBR(name, r, N);
}

// ---------- sprite / atlas textures ----------
export function makeParticleAtlas() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S * 2;
  const g = c.getContext("2d")!;
  const rnd = mulberry32(42);
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * S;
    const oy = Math.floor(t / 2) * S;
    const img = g.createImageData(S, S);
    if (t < 3) {
      const f = noiseField(S, 4 + t, 4 + t, 4, 100 + t * 13);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = (x / S - 0.5) * 2;
          const dy = (y / S - 0.5) * 2;
          const d = Math.sqrt(dx * dx + dy * dy);
          let a = Math.max(0, 1 - d);
          a = a * a * (3 - 2 * a);
          a *= 0.35 + f[y * S + x] * 1.1;
          a = Math.min(1, a);
          const i = (y * S + x) * 4;
          const v = 180 + f[y * S + x] * 75;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = a * 255;
        }
    } else {
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = (x / S - 0.5) * 2;
          const dy = (y / S - 0.5) * 2;
          const d = Math.sqrt(dx * dx + dy * dy);
          const a = Math.max(0, 1 - d);
          const v = Math.pow(a, 2.2);
          const i = (y * S + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = v * 255;
        }
    }
    g.putImageData(img, ox, oy);
  }
  void rnd;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function makeScorchTexture() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const f = noiseField(S, 5, 5, 4, 555);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (x / S - 0.5) * 2;
      const dy = (y / S - 0.5) * 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      let a = Math.max(0, 1 - d);
      a = Math.min(1, a * (0.8 + f[y * S + x] * 1.4));
      a = Math.pow(a, 1.4);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 8;
      img.data[i + 3] = a * 235;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFootprintTexture() {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(60,75,95,0.55)";
  g.beginPath();
  g.ellipse(32, 20, 11, 15, 0, 0, 7);
  g.fill();
  g.beginPath();
  g.ellipse(32, 47, 9, 11, 0, 0, 7);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type FoliageKind = "broad" | "fern" | "pine" | "grass";

export function makeFoliage(kind: FoliageKind, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rnd = mulberry32(kind.length * 991 + 5);
  const S = size;
  g.clearRect(0, 0, S, S);
  const leaf = (x: number, y: number, ang: number, len: number, wid: number, col: string, vein: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(wid, -len * 0.45, 0, -len);
    g.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
    g.fill();
    g.strokeStyle = vein;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -len * 0.95);
    g.stroke();
    for (let i = 1; i < 6; i++) {
      g.beginPath();
      g.moveTo(0, (-len * i) / 6.5);
      g.lineTo(wid * 0.7, (-len * (i + 1.2)) / 6.5);
      g.moveTo(0, (-len * i) / 6.5);
      g.lineTo(-wid * 0.7, (-len * (i + 1.2)) / 6.5);
      g.stroke();
    }
    g.restore();
  };
  if (kind === "broad") {
    for (let i = 0; i < 26; i++) {
      const a = (rnd() - 0.5) * 3.0;
      const sh = Math.floor(35 + rnd() * 45);
      leaf(S / 2 + (rnd() - 0.5) * 30, S * 0.9 + rnd() * 10, a, S * (0.35 + rnd() * 0.45), S * (0.08 + rnd() * 0.07), `rgb(${sh * 0.45},${sh * 1.7},${sh * 0.5})`, `rgba(20,50,10,0.6)`);
    }
  } else if (kind === "fern") {
    for (let i = 0; i < 9; i++) {
      const a = -1.35 + (i / 8) * 2.7;
      const len = S * 0.85;
      g.save();
      g.translate(S / 2, S * 0.97);
      g.rotate(a);
      g.strokeStyle = "#2d4a1a";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -len);
      g.stroke();
      for (let k = 1; k < 22; k++) {
        const y = -(k / 22) * len;
        const l = (1 - k / 24) * S * 0.12 + 4;
        const sh = 50 + rnd() * 30;
        g.fillStyle = `rgb(${sh * 0.5},${sh * 1.9},${sh * 0.55})`;
        for (const sgn of [-1, 1]) {
          g.beginPath();
          g.ellipse(sgn * l * 0.55, y - 3, l * 0.55, 3.2, sgn * 0.5, 0, 7);
          g.fill();
        }
      }
      g.restore();
    }
  } else if (kind === "grass") {
    for (let i = 0; i < 40; i++) {
      const x = S * 0.1 + rnd() * S * 0.8;
      const h = S * (0.4 + rnd() * 0.55);
      const sh = 70 + rnd() * 70;
      g.fillStyle = `rgb(${sh * 0.55},${sh * 1.4},${sh * 0.4})`;
      g.beginPath();
      g.moveTo(x - 4, S);
      g.quadraticCurveTo(x - 2 + (rnd() - 0.5) * 30, S - h * 0.6, x + (rnd() - 0.5) * 40, S - h);
      g.quadraticCurveTo(x + 2, S - h * 0.6, x + 4, S);
      g.fill();
    }
  } else {
    // pine branches
    for (let i = 0; i < 7; i++) {
      const y = S * (0.12 + i * 0.12);
      const w = S * (0.12 + i * 0.07);
      for (let k = 0; k < 90; k++) {
        const x = S / 2 + (rnd() - 0.5) * 2 * w;
        const yy = y + Math.abs(x - S / 2) * 0.35 + (rnd() - 0.5) * 12;
        const sh = 40 + rnd() * 40;
        g.strokeStyle = `rgb(${sh * 0.4},${sh * 1.5},${sh * 0.7})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(S / 2, y);
        g.lineTo(x, yy);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
