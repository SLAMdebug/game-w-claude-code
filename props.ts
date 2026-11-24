import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Batcher, World } from "./world";
import { getPBR, makeFoliage } from "./textures";
import type { Surface } from "./types";

export interface Emitter {
  x: number; y: number; z: number;
  kind: "smoke" | "fire" | "steam" | "sparks" | "flare";
  rate: number; scale: number; acc: number;
}
export interface BarrelDef { x: number; y: number; z: number }
export interface Ctx {
  b: Batcher;
  w: World;
  rnd: () => number;
  anim: ((t: number, dt: number) => void)[];
  emitters: Emitter[];
  barrels: BarrelDef[];
  group: THREE.Group;
  mats: Record<string, THREE.Material>;
  cover: { x: number; z: number }[];
  avoid: { x: number; z: number; r: number }[];
  tex: number;
}

export function free(c: Ctx, x: number, z: number, m = 0) {
  for (const a of c.avoid) {
    const dx = x - a.x, dz = z - a.z;
    if (dx * dx + dz * dz < (a.r + m) * (a.r + m)) return false;
  }
  return true;
}

export function pbrMat(name: string, tex: number, o: { color?: THREE.ColorRepresentation; env?: number; normal?: number; emissive?: THREE.Color; transparent?: boolean; opacity?: number } = {}) {
  const p = getPBR(name, tex);
  const m = new THREE.MeshStandardMaterial({ map: p.map, normalMap: p.normalMap, roughnessMap: p.orm, metalnessMap: p.orm, roughness: 1, metalness: 1, envMapIntensity: o.env ?? 1 });
  if (o.color !== undefined) m.color = new THREE.Color(o.color);
  m.normalScale.setScalar(o.normal ?? 1);
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 0.8; }
  return m;
}
export const glowMat = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

export function foliageMat(kind: "broad" | "fern" | "pine" | "grass", tint = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ map: makeFoliage(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, color: tint });
  return m;
}

export function commonMats(tex: number, t: { wall: string; wallTint?: number; roof?: string; accent?: number; rust?: string; dark?: string; stone?: string; wood?: string; floor?: string }) {
  const M: Record<string, THREE.Material> = {};
  M.wall = pbrMat(t.wall, tex, { color: t.wallTint ?? 0xffffff });
  M.wall2 = pbrMat(t.wall, tex, { color: 0xbbbbbb, normal: 1.2 });
  M.roof = pbrMat(t.roof ?? "metal", tex, { color: 0xcccccc });
  M.trim = pbrMat(t.dark ?? "darkMetal", tex);
  M.rust = pbrMat(t.rust ?? "metalRust", tex);
  M.hazard = pbrMat("hazard", tex);
  M.grate = pbrMat("grating", tex);
  M.tread = pbrMat("tread", tex);
  M.corrug = pbrMat("corrug", tex);
  M.burnt = pbrMat("burnt", tex);
  M.fabric = pbrMat("fabric", tex);
  M.stone = pbrMat(t.stone ?? "rock", tex);
  M.wood = pbrMat(t.wood ?? "wood", tex);
  M.floor = pbrMat(t.floor ?? "concrete", tex);
  M.glow = glowMat(3.2, 1.5, 0.45);
  M.glowB = glowMat(0.6, 1.9, 3.6);
  M.glowR = glowMat(3.6, 0.3, 0.2);
  M.glowW = glowMat(3, 3, 2.7);
  const cont = [0x7a2e22, 0x2d4a6d, 0x57603a, 0xa0782c, 0x6a6e72];
  cont.forEach((c, i) => (M["cont" + i] = pbrMat("corrug", tex, { color: c })));
  M.glass = new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.04, metalness: 0.9, envMapIntensity: 2.2, emissive: new THREE.Color(0.02, 0.07, 0.1) });
  return M;
}

// ---------------- generic primitives ----------------
export function beam(c: Ctx, mat: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg = 8, tile = 4) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * r * 6.28) / tile, (uv.getY(i) * len) / tile);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  c.b.addGeo(g, mat, (ax + bx) / 2, (az + bz) / 2);
}
export function boxBetween(c: Ctx, mat: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  const g = new THREE.BoxGeometry(w, h, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  c.b.addGeo(g, mat, (ax + bx) / 2, (az + bz) / 2);
}

function solid(c: Ctx, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, surface: Surface = "concrete", walk = true, cover = true) {
  c.w.addBox(cx, cy, cz, sx, sy, sz, surface, walk);
  if (cover && sy > 1.1 && sx < 40 && sz < 40) {
    const hx = sx / 2 + 1.1, hz = sz / 2 + 1.1;
    c.cover.push({ x: cx + hx, z: cz }, { x: cx - hx, z: cz }, { x: cx, z: cz + hz }, { x: cx, z: cz - hz });
  }
}

/** solid box with visual + collision. y0 = bottom */
export function block(c: Ctx, mat: string, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, surface: Surface = "concrete", walk = true, tile = 4, cover = true) {
  c.b.box(mat, cx, y0 + sy / 2, cz, sx, sy, sz, 0, tile);
  solid(c, cx, y0 + sy / 2, cz, sx, sy, sz, surface, walk, cover);
}

export function column(c: Ctx, mat: string, x: number, z: number, r: number, y0: number, h: number, surface: Surface = "metal", seg = 12, walk = false) {
  c.b.cyl(mat, x, y0 + h / 2, z, r, r, h, seg, 4);
  c.w.addCyl(x, z, r, y0, y0 + h, surface, walk);
  if (r > 0.5) c.cover.push({ x: x + r + 1, z }, { x: x - r - 1, z }, { x, z: z + r + 1 }, { x, z: z - r - 1 });
}

export function stairs(c: Ctx, x: number, z: number, dir: "e" | "w" | "n" | "s", y0: number, H: number, width = 2.6, mat = "wall2", depth = 0.9) {
  const rise = 0.4;
  const n = Math.ceil(H / rise);
  for (let i = 0; i < n; i++) {
    const hh = H - i * rise;
    const off = (i + 0.5) * depth;
    let cx = x, cz = z, sx = depth, sz = width;
    if (dir === "e") cx = x + off;
    else if (dir === "w") cx = x - off;
    else if (dir === "n") { cz = z - off; sx = width; sz = depth; }
    else { cz = z + off; sx = width; sz = depth; }
    c.b.box(mat, cx, y0 + hh / 2, cz, sx, hh, sz, 0, 3);
    c.w.addBox(cx, y0 + hh / 2, cz, sx, hh, sz, "concrete", true);
  }
}

export interface BuildingOpts {
  x: number; z: number; sx: number; sz: number; h?: number;
  wall?: string; roof?: string; doors?: ("n" | "s" | "e" | "w")[];
  windows?: boolean; stairs?: "n" | "s" | "e" | "w" | null; parapet?: boolean; broken?: boolean; trim?: string; glow?: string; thick?: number; doorW?: number;
}

export function building(c: Ctx, o: BuildingOpts) {
  const { x, z, sx, sz } = o;
  const h = o.h ?? 4.6;
  const wall = o.wall ?? "wall";
  const t = o.thick ?? 0.6;
  const y0 = c.w.heightAt(x, z);
  const doorW = o.doorW ?? 3.4;
  const doors = o.doors ?? [];
  // foundation
  block(c, "floor", x, y0 - 1.2, z, sx + 1.4, 1.5, sz + 1.4, "concrete", true, 4, false);
  const broken = !!o.broken;
  const seg = (side: "n" | "s" | "e" | "w") => {
    const horiz = side === "n" || side === "s";
    const len = horiz ? sx : sz;
    const cx = side === "e" ? x + sx / 2 - t / 2 : side === "w" ? x - sx / 2 + t / 2 : x;
    const cz = side === "s" ? z + sz / 2 - t / 2 : side === "n" ? z - sz / 2 + t / 2 : z;
    const mk = (off: number, l: number, hh: number, yb: number) => {
      if (l < 0.1) return;
      const px = horiz ? cx + off : cx, pz = horiz ? cz : cz + off;
      block(c, wall, px, y0 + yb, pz, horiz ? l : t, hh, horiz ? t : l, "concrete", false, 4, false);
    };
    const hh = broken ? h * (0.45 + c.rnd() * 0.5) : h;
    if (doors.includes(side)) {
      const side1 = (len - doorW) / 2;
      mk(-(len - side1) / 2, side1, hh, 0);
      mk((len - side1) / 2, side1, hh, 0);
      if (!broken) {
        // lintel
        const px = horiz ? cx : cx, pz = horiz ? cz : cz;
        c.b.box(wall, px, y0 + 2.9 + (h - 2.9) / 2, pz, horiz ? doorW : t, h - 2.9, horiz ? t : doorW, 0, 4);
        c.w.addBox(px, y0 + 2.9 + (h - 2.9) / 2, pz, horiz ? doorW : t, h - 2.9, horiz ? t : doorW, "concrete", false);
        // door frame glow
        c.b.box("glowW", horiz ? cx : cx + (side === "e" ? t / 2 + 0.02 : -t / 2 - 0.02), y0 + 2.8, horiz ? cz + (side === "s" ? t / 2 + 0.02 : -t / 2 - 0.02) : cz, horiz ? doorW : 0.05, 0.08, horiz ? 0.05 : doorW);
      }
    } else if (broken && c.rnd() < 0.5) {
      const gl = len * (0.25 + c.rnd() * 0.25);
      const off = (c.rnd() - 0.5) * (len - gl);
      mk((-len / 2 + off - gl / 2) / 2, Math.max(0, len / 2 + off - gl / 2), hh, 0);
      mk(off + gl / 2 + (len / 2 - off - gl / 2) / 2, Math.max(0, len / 2 - off - gl / 2), hh, 0);
    } else mk(0, len, hh, 0);
    // windows
    if (o.windows !== false && !broken && len > 8) {
      const n = Math.floor(len / 6);
      for (let i = 0; i < n; i++) {
        const off = -len / 2 + (i + 0.5) * (len / n);
        if (doors.includes(side) && Math.abs(off) < doorW) continue;
        const wx = horiz ? cx + off : cx + (side === "e" ? t / 2 + 0.03 : -t / 2 - 0.03);
        const wz = horiz ? cz + (side === "s" ? t / 2 + 0.03 : -t / 2 - 0.03) : cz + off;
        c.b.box(o.glow ?? "glowB", wx, y0 + h * 0.62, wz, horiz ? 1.8 : 0.05, 0.7, horiz ? 0.05 : 1.8);
      }
    }
  };
  (["n", "s", "e", "w"] as const).forEach(seg);
  // roof
  if (!broken) {
    block(c, o.roof ?? "roof", x, y0 + h, z, sx + 0.8, 0.5, sz + 0.8, "metal", true, 4, false);
    if (o.parapet !== false) {
      const p = 0.9;
      block(c, "wall2", x, y0 + h + 0.5, z - sz / 2 - 0.2, sx + 0.8, p, 0.3, "concrete", false, 4, false);
      block(c, "wall2", x, y0 + h + 0.5, z + sz / 2 + 0.2, sx + 0.8, p, 0.3, "concrete", false, 4, false);
      block(c, "wall2", x - sx / 2 - 0.2, y0 + h + 0.5, z, 0.3, p, sz + 0.8, "concrete", false, 4, false);
      block(c, "wall2", x + sx / 2 + 0.2, y0 + h + 0.5, z, 0.3, p, sz + 0.8, "concrete", false, 4, false);
    }
    // rooftop equipment
    for (let i = 0; i < 2; i++) {
      const vx = x + (c.rnd() - 0.5) * (sx - 6), vz = z + (c.rnd() - 0.5) * (sz - 6);
      block(c, "trim", vx, y0 + h + 0.5, vz, 2 + c.rnd() * 2, 1.4, 2 + c.rnd() * 2, "metal", true, 3, false);
    }
    // interior light strip
    c.b.box("glowW", x, y0 + h - 0.06, z, Math.max(2, sx * 0.5), 0.06, 0.3);
  }
  // interior clutter
  const crates = broken ? 2 : 4;
  for (let i = 0; i < crates; i++) {
    const cx = x + (c.rnd() - 0.5) * (sx - 4), cz = z + (c.rnd() - 0.5) * (sz - 4);
    block(c, c.rnd() < 0.5 ? "wood" : "trim", cx, y0, cz, 1.2 + c.rnd(), 1 + c.rnd() * 0.8, 1.2 + c.rnd(), "wood", true, 2);
  }
  if (o.stairs && !broken) {
    const s = o.stairs;
    const ex = s === "e" ? x + sx / 2 + 0.6 : s === "w" ? x - sx / 2 - 0.6 : x + sx / 4;
    const ez = s === "s" ? z + sz / 2 + 0.6 : s === "n" ? z - sz / 2 - 0.6 : z + sz / 4;
    stairs(c, ex, ez, s, y0, h + 0.5, 2.6, "wall2");
  }
  c.avoid.push({ x, z, r: Math.max(sx, sz) * 0.7 + 3 });
}

export function container(c: Ctx, x: number, z: number, rot90: boolean, tier = 0, ci = -1) {
  const ci2 = ci >= 0 ? ci : Math.floor(c.rnd() * 5);
  const y0 = c.w.heightAt(x, z) + tier * 2.6;
  const sx = rot90 ? 2.44 : 6.1, sz = rot90 ? 6.1 : 2.44;
  block(c, "cont" + ci2, x, y0 + (tier === 0 ? -0.2 : 0), z, sx, 2.6 + (tier === 0 ? 0.2 : 0), sz, "metal", true, 2.5, tier === 0);
}
export function containerStack(c: Ctx, x: number, z: number, rot90: boolean, tiers: number) {
  const ci = Math.floor(c.rnd() * 5);
  for (let t = 0; t < tiers; t++) container(c, x, z, rot90, t, (ci + t) % 5);
}

export function sandbags(c: Ctx, x: number, z: number, len: number, rot90: boolean, rows = 2) {
  const y0 = c.w.heightAt(x, z);
  const n = Math.floor(len / 0.9);
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < n - r; i++) {
      const o = (i - n / 2 + 0.5 + r * 0.5) * 0.9;
      const px = rot90 ? x : x + o, pz = rot90 ? z + o : z;
      c.b.box("fabric", px, y0 + 0.2 + r * 0.38, pz, rot90 ? 0.8 : 0.95, 0.4, rot90 ? 0.95 : 0.8, (c.rnd() - 0.5) * 0.15, 1.5);
    }
  const sx = rot90 ? 0.9 : len, sz = rot90 ? len : 0.9;
  c.w.addBox(x, y0 + rows * 0.19, z, sx, rows * 0.38, sz, "sand", false);
  c.cover.push({ x: x + (rot90 ? 1.2 : 0), z: z + (rot90 ? 0 : 1.2) }, { x: x - (rot90 ? 1.2 : 0), z: z - (rot90 ? 0 : 1.2) });
}

export function jersey(c: Ctx, x: number, z: number, rot90: boolean, n = 3) {
  const y0 = c.w.heightAt(x, z);
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * 3.1;
    const px = rot90 ? x : x + o, pz = rot90 ? z + o : z;
    block(c, "floor", px, y0 - 0.1, pz, rot90 ? 0.7 : 3, 1.3, rot90 ? 3 : 0.7, "concrete", false, 2);
  }
}

export function crate(c: Ctx, x: number, z: number, s = 1.4, mat = "wood") {
  const y0 = c.w.heightAt(x, z);
  block(c, mat, x, y0 - 0.05, z, s, s, s, "wood", true, 1.5);
}

export function tankWreck(c: Ctx, x: number, z: number, ry: number, smoke = true) {
  const y0 = c.w.heightAt(x, z);
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const hull = at(0, 0);
  c.b.box("burnt", hull[0], y0 + 1.0, hull[1], 7, 1.2, 3.4, ry, 3);
  const g = at(3.6, 0);
  c.b.box("burnt", g[0], y0 + 1.0, g[1], 2, 0.9, 3.2, ry, 3, 0, -0.45);
  for (const s of [-1, 1]) {
    const tr = at(0, s * 2.0);
    c.b.box("tread", tr[0], y0 + 0.75, tr[1], 7.6, 1.5, 1, ry, 2);
    for (let i = 0; i < 6; i++) {
      const wh = at(-3 + i * 1.2, s * 2.52);
      c.b.cyl("trim", wh[0], y0 + 0.65, wh[1], 0.55, 0.55, 0.2, 10, 2, Math.PI / 2, 0, ry);
    }
  }
  const tu = at(-0.4, 0);
  c.b.cyl("burnt", tu[0], y0 + 1.95, tu[1], 1.3, 1.5, 0.9, 12, 3);
  const bar = at(-0.4 + 3.2, 0.1);
  c.b.cyl("trim", bar[0], y0 + 2.05, bar[1], 0.16, 0.2, 5.6, 8, 3, 0, 0, ry + Math.PI / 2 + 0.05);
  const hatch = at(-0.8, 0.4);
  c.b.box("rust", hatch[0], y0 + 2.5, hatch[1], 0.8, 0.12, 0.8, ry + 0.4, 1);
  c.w.addCyl(x, z, 3.1, y0 - 0.5, y0 + 2.4, "metal", true);
  c.cover.push({ x: x + 4.5, z }, { x: x - 4.5, z }, { x, z: z + 4 }, { x, z: z - 4 });
  if (smoke) {
    c.emitters.push({ x: tu[0], y: y0 + 2.5, z: tu[1], kind: "smoke", rate: 3, scale: 1.3, acc: 0 });
    c.emitters.push({ x: tu[0], y: y0 + 2.4, z: tu[1], kind: "fire", rate: 4, scale: 0.9, acc: 0 });
  }
}

export function crashedShip(c: Ctx, x: number, z: number, ry: number, big = 1) {
  const y0 = c.w.heightAt(x, z);
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const L = 22 * big;
  const f = at(0, 0);
  c.b.box("burnt", f[0], y0 + 2.2 * big, f[1], L, 4 * big, 6 * big, ry, 4);
  const nose = at(L / 2 + 3 * big, 0);
  c.b.box("burnt", nose[0], y0 + 1.3 * big, nose[1], 7 * big, 2.2 * big, 5 * big, ry, 4, 0, -0.0);
  const tail = at(-L / 2 - 6 * big, 0);
  c.b.box("rust", tail[0], y0 + 4 * big, tail[1], 12 * big, 2 * big, 3 * big, ry, 4);
  for (const s of [-1, 1]) {
    const w = at(-2 * big, s * 6.5 * big);
    c.b.box("rust", w[0], y0 + 1.6 * big, w[1], 9 * big, 0.6, 7 * big, ry, 4);
    const e = at(-5 * big, s * 4 * big);
    c.b.cyl("trim", e[0], y0 + 2 * big, e[1], 1.3 * big, 1.5 * big, 5 * big, 12, 3, Math.PI / 2, 0, ry);
    c.emitters.push({ x: e[0], y: y0 + 3 * big, z: e[1], kind: "smoke", rate: 4, scale: 1.8, acc: 0 });
  }
  const cockpit = at(L / 2 + 2 * big, 0);
  c.b.box("glass", cockpit[0], y0 + 3.2 * big, cockpit[1], 3 * big, 1 * big, 4 * big, ry, 4, 0, -0.35);
  // collisions as two boxes along dominant axis (approximated by cylinders)
  for (let i = -1; i <= 1; i++) {
    const p = at(i * 7 * big, 0);
    c.w.addCyl(p[0], p[1], 3.6 * big, y0 - 0.5, y0 + 4.2 * big, "metal", true);
  }
  c.emitters.push({ x: f[0], y: y0 + 4.5 * big, z: f[1], kind: "fire", rate: 5, scale: 1.4, acc: 0 });
  c.emitters.push({ x: f[0], y: y0 + 4.5 * big, z: f[1], kind: "smoke", rate: 5, scale: 2.3, acc: 0 });
  c.avoid.push({ x, z, r: 16 * big });
}

export function tower(c: Ctx, x: number, z: number, h: number, w = 2.4, mat = "trim") {
  const y0 = c.w.heightAt(x, z);
  const hw = w / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    beam(c, mat, x + sx * hw, y0 - 0.3, z + sz * hw, x + sx * hw * 0.45, y0 + h, z + sz * hw * 0.45, 0.14, 6);
  }
  const n = Math.floor(h / 4);
  for (let i = 1; i <= n; i++) {
    const hh = (i / (n + 1)) * h;
    const k = 1 - 0.55 * (hh / h);
    const e = hw * k;
    beam(c, mat, x - e, y0 + hh, z - e, x + e, y0 + hh, z - e, 0.07, 5);
    beam(c, mat, x + e, y0 + hh, z - e, x + e, y0 + hh, z + e, 0.07, 5);
    beam(c, mat, x + e, y0 + hh, z + e, x - e, y0 + hh, z + e, 0.07, 5);
    beam(c, mat, x - e, y0 + hh, z + e, x - e, y0 + hh, z - e, 0.07, 5);
    beam(c, mat, x - e, y0 + hh - h / (n + 1), z - e, x + e, y0 + hh, z - e, 0.05, 4);
  }
  c.b.box("trim", x, y0 + h + 0.3, z, w * 0.7, 0.5, w * 0.7, 0, 2);
  c.b.box("glowR", x, y0 + h + 1.1, z, 0.35, 0.35, 0.35);
  c.w.addBox(x, y0 + h / 2, z, w * 0.9, h, w * 0.9, "metal", false);
  c.cover.push({ x: x + w, z }, { x: x - w, z });
}

export function storageTank(c: Ctx, x: number, z: number, r: number, h: number, mat = "metal") {
  const y0 = c.w.heightAt(x, z);
  c.b.cyl(mat, x, y0 + h / 2, z, r, r, h, 24, 5);
  c.b.sphere(mat, x, y0 + h, z, r, 0.28, 5);
  c.b.cyl("trim", x, y0 + h * 0.35, z, r + 0.08, r + 0.08, 0.35, 24, 2);
  c.b.cyl("trim", x, y0 + h * 0.7, z, r + 0.08, r + 0.08, 0.35, 24, 2);
  // ladder
  c.b.box("trim", x + r * 0.7, y0 + h / 2, z + r * 0.7, 0.6, h, 0.1, Math.PI / 4, 1);
  c.w.addCyl(x, z, r, y0 - 0.5, y0 + h, "metal", false);
  c.cover.push({ x: x + r + 1.2, z }, { x: x - r - 1.2, z }, { x, z: z + r + 1.2 }, { x, z: z - r - 1.2 });
  c.avoid.push({ x, z, r: r + 3 });
}

export function catwalk(c: Ctx, x1: number, z1: number, x2: number, z2: number, y: number, width = 3, supports = true) {
  const horiz = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const len = horiz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  const sx = horiz ? len : width, sz = horiz ? width : len;
  c.b.box("grate", cx, y - 0.1, cz, sx, 0.2, sz, 0, 3);
  c.w.addBox(cx, y - 0.1, cz, sx, 0.2, sz, "metal", true);
  // rails
  for (const s of [-1, 1]) {
    const rx = horiz ? cx : cx + s * (width / 2 - 0.05), rz = horiz ? cz + s * (width / 2 - 0.05) : cz;
    c.b.box("trim", rx, y + 0.55, rz, horiz ? len : 0.08, 0.08, horiz ? 0.08 : len, 0, 1);
    c.b.box("trim", rx, y + 0.2, rz, horiz ? len : 0.05, 0.05, horiz ? 0.05 : len, 0, 1);
    const n = Math.floor(len / 3);
    for (let i = 0; i <= n; i++) {
      const o = -len / 2 + (i * len) / n;
      c.b.box("trim", horiz ? cx + o : rx, y + 0.3, horiz ? rz : cz + o, 0.08, 0.6, 0.08, 0, 1);
    }
  }
  if (supports) {
    const n = Math.max(1, Math.floor(len / 14));
    for (let i = 0; i <= n; i++) {
      const o = -len / 2 + (i * len) / n;
      const px = horiz ? cx + o : cx, pz = horiz ? cz : cz + o;
      const gy = c.w.heightAt(px, pz);
      c.b.cyl("trim", px, (gy + y - 0.2) / 2, pz, 0.28, 0.28, y - 0.2 - gy, 8, 3);
      c.w.addCyl(px, pz, 0.28, gy, y - 0.2, "metal", false);
    }
  }
}

export function lamp(c: Ctx, x: number, z: number, h = 7, glow = "glowW", dir = 1) {
  const y0 = c.w.heightAt(x, z);
  c.b.cyl("trim", x, y0 + h / 2, z, 0.1, 0.16, h, 6, 3);
  c.b.box("trim", x + dir * 0.7, y0 + h, z, 1.6, 0.14, 0.4);
  c.b.box(glow, x + dir * 1.1, y0 + h - 0.1, z, 0.9, 0.06, 0.3);
  c.w.addCyl(x, z, 0.16, y0, y0 + h, "metal", false);
}

export function dish(c: Ctx, x: number, z: number, r = 4, rotate = true) {
  const y0 = c.w.heightAt(x, z);
  c.b.cyl("wall2", x, y0 + 1.5, z, 1, 1.6, 3, 10, 3);
  c.w.addCyl(x, z, 1.6, y0, y0 + 3, "metal", false);
  const grp = new THREE.Group();
  grp.position.set(x, y0 + 3.2, z);
  const dishG = new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, 0.7);
  const dm = new THREE.Mesh(dishG, c.mats.wall2);
  dm.rotation.x = -1.0;
  dm.position.y = r * 0.5;
  dm.castShadow = true;
  (dm.material as THREE.Material).side = THREE.DoubleSide;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, r * 1.1, 6), c.mats.trim);
  arm.position.set(0, r * 0.6 + 0.5, -r * 0.45);
  arm.rotation.x = 0.5 - 1.0;
  const feed = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), c.mats.glowR);
  feed.position.set(0, r * 0.5 + r * 0.9, -r * 0.8);
  grp.add(dm, arm, feed);
  c.group.add(grp);
  if (rotate) c.anim.push((t) => { grp.rotation.y = t * 0.15 + x; });
  c.cover.push({ x: x + 3, z }, { x: x - 3, z });
}

export function barrel(c: Ctx, x: number, z: number) {
  c.barrels.push({ x, y: c.w.heightAt(x, z), z });
}

export function barrelCluster(c: Ctx, x: number, z: number, n = 3) {
  for (let i = 0; i < n; i++) barrel(c, x + (c.rnd() - 0.5) * 3.5, z + (c.rnd() - 0.5) * 3.5);
}

export function bunker(c: Ctx, x: number, z: number, rot90 = false, mat = "wall") {
  const y0 = c.w.heightAt(x, z);
  const sx = rot90 ? 5 : 8, sz = rot90 ? 8 : 5;
  block(c, mat, x, y0 - 0.5, z, sx, 3.4, sz, "concrete", true, 3);
  // firing slit
  const fx = rot90 ? sx / 2 + 0.03 : 0, fz = rot90 ? 0 : -sz / 2 - 0.03;
  c.b.box("glass", x + fx, y0 + 1.6, z + fz, rot90 ? 0.05 : 3, 0.35, rot90 ? 3 : 0.05);
  block(c, "wall2", x, y0 + 2.9, z, sx + 0.4, 0.4, sz + 0.4, "concrete", true, 3, false);
  c.avoid.push({ x, z, r: 8 });
}

export function sandRock(c: Ctx, x: number, z: number, s: number, mat = "stone", collide = true) {
  const y0 = c.w.heightAt(x, z);
  const ry = s * (0.6 + c.rnd() * 0.5);
  c.b.rock(mat, x, y0 + ry * 0.35, z, s, ry, s * (0.7 + c.rnd() * 0.6), c.rnd() * 100, s > 6 ? 3 : 2, 0.4);
  if (collide) c.w.addCyl(x, z, s * 0.8, y0 - 1, y0 + ry * 1.1, "rock", s < 3.5);
  if (s > 1.8) c.cover.push({ x: x + s + 1, z }, { x: x - s - 1, z }, { x, z: z + s + 1 }, { x, z: z - s - 1 });
}

// -------- flyers / ships (decor) ----------
export function buildFighter(team: number) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: team === 0 ? 0xb8c0cc : 0x2a2a30, roughness: 0.4, metalness: 0.85 });
  const glow = new THREE.MeshBasicMaterial({ color: team === 0 ? new THREE.Color(0.5, 1.6, 4) : new THREE.Color(4, 0.6, 0.3), toneMapped: false });
  const geos: THREE.BufferGeometry[] = [];
  const fus = new THREE.CylinderGeometry(0.7, 1.1, 9, 8);
  fus.rotateX(Math.PI / 2);
  geos.push(fus);
  const nose = new THREE.ConeGeometry(0.7, 3.5, 8);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, -6.2);
  geos.push(nose);
  for (const s of [-1, 1]) {
    const wing = new THREE.BoxGeometry(6, 0.14, 3.4);
    wing.translate(s * 3.6, 0, 1.3);
    wing.rotateZ(s * -0.1);
    geos.push(wing);
    const eng = new THREE.CylinderGeometry(0.5, 0.6, 3, 8);
    eng.rotateX(Math.PI / 2);
    eng.translate(s * 1.8, 0, 3.2);
    geos.push(eng);
    const fin = new THREE.BoxGeometry(0.1, 1.8, 1.8);
    fin.translate(s * 6.5, 0.8, 2.8);
    geos.push(fin);
  }
  const body = new THREE.Mesh(mergeGeometries(geos.map((x) => (x.index ? x : x))) as THREE.BufferGeometry, mat);
  g.add(body);
  const e = new THREE.Mesh(new THREE.CircleGeometry(0.5, 10), glow);
  const e1 = e.clone(), e2 = e.clone();
  e1.position.set(1.8, 0, 4.75); e2.position.set(-1.8, 0, 4.75);
  e1.rotation.y = e2.rotation.y = Math.PI;
  g.add(e1, e2);
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 40), new THREE.MeshBasicMaterial({ color: team === 0 ? new THREE.Color(0.3, 0.9, 2.5) : new THREE.Color(2.5, 0.4, 0.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  trail.rotation.x = Math.PI / 2;
  trail.position.z = 24;
  g.add(trail);
  g.scale.setScalar(1.5);
  return g;
}

export function buildCapitalShip(team: number) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: team === 0 ? 0x9aa4b2 : 0x2c2c33, roughness: 0.55, metalness: 0.8 });
  const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.1, 1.2), toneMapped: false });
  const eng = new THREE.MeshBasicMaterial({ color: team === 0 ? new THREE.Color(0.5, 1.5, 4) : new THREE.Color(4, 0.8, 0.4), toneMapped: false });
  const geos: THREE.BufferGeometry[] = [];
  const hull = new THREE.BoxGeometry(60, 12, 320);
  hull.translate(0, 0, 0);
  geos.push(hull);
  const nose = new THREE.CylinderGeometry(0.1, 30, 180, 4);
  nose.rotateX(-Math.PI / 2);
  nose.rotateZ(Math.PI / 4);
  nose.scale(1, 0.2, 1);
  nose.translate(0, 0, -250);
  geos.push(nose);
  const tower = new THREE.BoxGeometry(22, 24, 40);
  tower.translate(0, 18, 110);
  geos.push(tower);
  const t2 = new THREE.BoxGeometry(12, 10, 20);
  t2.translate(0, 34, 112);
  geos.push(t2);
  const t3 = new THREE.BoxGeometry(46, 6, 80);
  t3.translate(0, 8, 60);
  geos.push(t3);
  g.add(new THREE.Mesh(mergeGeometries(geos)!, mat));
  const wg: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 60; i++) {
    const w = new THREE.BoxGeometry(1.4, 0.6, 0.6);
    w.translate(11.2, 18 + (i % 3) * 3.5, 95 + Math.floor(i / 3) * 1.8);
    wg.push(w);
    const w2 = w.clone();
    w2.translate(-22.4, 0, 0);
    wg.push(w2);
  }
  g.add(new THREE.Mesh(mergeGeometries(wg)!, win));
  const eg: THREE.BufferGeometry[] = [];
  for (let i = -2; i <= 2; i++) {
    const e = new THREE.CylinderGeometry(5, 5, 4, 12);
    e.rotateX(Math.PI / 2);
    e.translate(i * 11, 0, 162);
    eg.push(e);
  }
  g.add(new THREE.Mesh(mergeGeometries(eg)!, eng));
  return g;
}
