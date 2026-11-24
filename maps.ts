import * as THREE from "three";
import type { MapId } from "./types";
import { Batcher, World, buildTerrain, makeSky, fbm2, ridge2, noise2 } from "./world";
import { getPBR, mulberry32 } from "./textures";
import type { WeatherKind } from "./fx";
import {
  Ctx, Emitter, BarrelDef, commonMats, pbrMat, foliageMat, free, building, container, containerStack, sandbags, jersey, crate, tankWreck,
  crashedShip, tower, storageTank, catwalk, lamp, dish, barrelCluster, bunker, sandRock, block, column, stairs, beam, buildCapitalShip,
} from "./props";

export interface Spawn { x: number; z: number; yaw: number }
export interface MapPointDef { name: string; letter: string; x: number; z: number; r: number }
export interface MapData {
  id: MapId; name: string; sub: string;
  group: THREE.Group; world: World;
  sunDir: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  fogColor: THREE.Color; fogDensity: number; envIntensity: number; particleTint: THREE.Color;
  exposure: number; tint: THREE.Color; saturation: number; contrast: number;
  bloom: { strength: number; threshold: number; radius: number }; vignette: number; godray: number;
  sky: THREE.Mesh;
  spawns: [Spawn[], Spawn[]]; points: MapPointDef[]; assault: MapPointDef[];
  emitters: Emitter[]; barrels: BarrelDef[]; cover: { x: number; z: number }[];
  weather: { kind: WeatherKind; count: number; base: number; cycle: number }[];
  dust: [number, number, number]; reverb: number; snowy: boolean; shake: number;
  update: (t: number, dt: number, cam: THREE.Vector3) => void;
  stormBase: number;
}

const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Zone { x: number; z: number; r: number; f: number; minH?: number; fixH?: number }
function mkHeight(raw: (x: number, z: number) => number, zones: Zone[]) {
  const zh = zones.map((z) => z.fixH ?? Math.max(raw(z.x, z.z), z.minH ?? -1e9));
  return (x: number, z: number) => {
    let h = raw(x, z);
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d < zn.r + zn.f) {
        const w = sm(zn.r + zn.f, zn.r, d);
        h = h * (1 - w) + zh[i] * w;
      }
    }
    return h;
  };
}

const POINTS: [number, number][] = [[-130, 12], [-66, -72], [0, 0], [66, 72], [130, -12]];
const LETTERS = ["A", "B", "C", "D", "E"];

function spawnsAround(cx: number, cz: number, face: number, n: number, w: number): Spawn[] {
  const out: Spawn[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 6);
    out.push({ x: cx + (face > 0 ? 1 : -1) * row * 5 * -1, z: cz + ((i % 6) - 2.5) * (w / 6), yaw: face > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  return out;
}

interface Base {
  id: MapId; name: string; sub: string; seed: number; tex: number; quality: number;
  half?: number;
  raw: (x: number, z: number) => number;
  zones?: Zone[];
  surface: (x: number, z: number, h: number) => import("./types").Surface;
  terrain: { tile: number; m1: string; m2: string; blend: (x: number, z: number, h: number, s: number) => number; tint: (x: number, z: number, h: number, s: number) => [number, number, number]; normalScale?: number };
  mats: (tex: number) => Record<string, THREE.Material>;
  sky: Parameters<typeof makeSky>[0];
  light: { sunColor: [number, number, number]; intensity: number; hemiSky: number; hemiGround: number; hemiI: number; fog: number; fogDensity: number; env: number; tint: [number, number, number] };
  grade: { exposure: number; tint: [number, number, number]; sat: number; contrast: number; bloom: [number, number, number]; vignette: number; godray: number };
  dust: [number, number, number];
  reverb: number; snowy?: boolean;
  weather: MapData["weather"];
  stormBase: number;
  build: (c: Ctx, md: { points: MapPointDef[]; rnd: () => number }) => void;
  extra?: (c: Ctx, group: THREE.Group) => void;
  shake?: number;
}

function baseMap(B: Base): MapData {
  const group = new THREE.Group();
  const rnd = mulberry32(B.seed);
  const half = B.half ?? 330;
  const points: MapPointDef[] = POINTS.map((p, i) => ({ name: "", letter: LETTERS[i], x: p[0], z: p[1], r: 13 }));
  const zones: Zone[] = [
    ...(B.zones ?? []),
    ...points.map((p) => ({ x: p.x, z: p.z, r: 24, f: 20, minH: B.id === "jungle" ? 2.2 : undefined })),
    { x: -196, z: 0, r: 34, f: 24, minH: B.id === "jungle" ? 2.5 : undefined },
    { x: 196, z: 0, r: 34, f: 24, minH: B.id === "jungle" ? 2.5 : undefined },
  ];
  const hf = mkHeight(B.raw, zones);
  const world = new World(half, 238, hf, 1.5);
  world.surfaceFn = (x, z) => B.surface(x, z, world.heightAt(x, z));
  const mats = B.mats(B.tex);
  const b = new Batcher(group, mats, 70, new Set(["glow", "glowB", "glowR", "glowW", "glass"]));
  const c: Ctx = { b, w: world, rnd, anim: [], emitters: [], barrels: [], group, mats, cover: [], avoid: [], tex: B.tex };
  for (const p of points) c.avoid.push({ x: p.x, z: p.z, r: 16 });
  c.avoid.push({ x: -196, z: 0, r: 36 }, { x: 196, z: 0, r: 36 });
  // terrain
  const t1 = getPBR(B.terrain.m1, B.tex);
  const t2 = getPBR(B.terrain.m2, B.tex);
  const terrain = buildTerrain(world, {
    size: half * 2, seg: Math.round(half * (B.quality > 0.7 ? 1 : 0.5)), tile: B.terrain.tile, mat1: t1, mat2: t2.map,
    blend: B.terrain.blend, tint: B.terrain.tint, normalScale: B.terrain.normalScale,
  });
  group.add(terrain);
  B.build(c, { points, rnd });
  b.flush();
  if (B.extra) B.extra(c, group);
  const sky = makeSky(B.sky);
  const L = B.light;
  const sunDir = B.sky.sunDir.clone().normalize();
  // capital ships (decor)
  const mkShip = (team: number, x: number, y: number, z: number, ry: number, s: number) => {
    const sh = buildCapitalShip(team);
    sh.traverse((o) => { const m = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (m) m.fog = false; });
    sh.position.set(x, y, z);
    sh.rotation.y = ry;
    sh.scale.setScalar(s);
    group.add(sh);
    return sh;
  };
  const s1 = mkShip(0, -380, 230, -480, 0.5, 0.9);
  const s2 = mkShip(1, 420, 260, 380, -2.3, 0.8);
  c.anim.push((t) => { s1.position.x = -380 + Math.sin(t * 0.01) * 20; s2.position.x = 420 + Math.cos(t * 0.01) * 20; });
  const spawns: [Spawn[], Spawn[]] = [spawnsAround(-190, 0, 1, 18, 40), spawnsAround(190, 0, -1, 18, 40)];
  const md: MapData = {
    id: B.id, name: B.name, sub: B.sub, group, world, sunDir, sunColor: new THREE.Color(...L.sunColor), sunIntensity: L.intensity,
    hemiSky: new THREE.Color(L.hemiSky), hemiGround: new THREE.Color(L.hemiGround), hemiI: L.hemiI,
    fogColor: new THREE.Color(L.fog), fogDensity: L.fogDensity, envIntensity: L.env, particleTint: new THREE.Color(...L.tint),
    exposure: B.grade.exposure, tint: new THREE.Color(...B.grade.tint), saturation: B.grade.sat, contrast: B.grade.contrast,
    bloom: { strength: B.grade.bloom[0], threshold: B.grade.bloom[1], radius: B.grade.bloom[2] }, vignette: B.grade.vignette, godray: B.grade.godray,
    sky, spawns, points, assault: [points[2], points[3], points[4]].map((p, i) => ({ ...p, name: ["Gate", "Relay", "Core"][i] })),
    emitters: c.emitters, barrels: c.barrels, cover: c.cover, weather: B.weather, dust: B.dust, reverb: B.reverb, snowy: !!B.snowy, shake: B.shake ?? 1,
    stormBase: B.stormBase,
    update: (t, dt, cam) => {
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      sky.position.copy(cam);
      for (const a of c.anim) a(t, dt);
    },
  };
  return md;
}

// shared base builders ---------------------------------------------------------
function militaryBase(c: Ctx, cx: number, face: number, style: "light" | "dark") {
  const sgn = face;
  const wall = style === "light" ? "wall" : "wall2";
  // hangars
  building(c, { x: cx - sgn * 8, z: -26, sx: 26, sz: 16, h: 7, wall, doors: ["e", "w"], stairs: "n" });
  building(c, { x: cx - sgn * 8, z: 26, sx: 26, sz: 16, h: 7, wall, doors: ["e", "w"], stairs: "s" });
  building(c, { x: cx - sgn * 24, z: 0, sx: 14, sz: 20, h: 5.2, wall, doors: ["e"], glow: style === "light" ? "glowB" : "glowR" });
  tower(c, cx + sgn * 10, -8, 24);
  tower(c, cx + sgn * 10, 8, 18);
  dish(c, cx - sgn * 4, 44, 4.5);
  dish(c, cx - sgn * 4, -44, 3.5);
  // landing pad
  const y0 = c.w.heightAt(cx + sgn * 6, 0);
  c.b.cyl("floor", cx + sgn * 6, y0 + 0.1, 0, 11, 11, 0.25, 32, 6);
  c.b.cyl("hazard", cx + sgn * 6, y0 + 0.13, 0, 8, 8, 0.2, 32, 4);
  c.w.addCyl(cx + sgn * 6, 0, 11, y0 - 0.5, y0 + 0.25, "concrete", true);
  for (let i = 0; i < 6; i++) containerStack(c, cx + sgn * 24, -34 + i * 14, true, 1 + (i % 2));
  for (let i = 0; i < 5; i++) { jersey(c, cx + sgn * 40, -28 + i * 14, true, 2); lamp(c, cx + sgn * 34, -30 + i * 15, 8, style === "light" ? "glowW" : "glowR", -sgn); }
  barrelCluster(c, cx + sgn * 16, -16, 3);
  barrelCluster(c, cx + sgn * 16, 17, 3);
  for (let i = 0; i < 4; i++) crate(c, cx + sgn * (14 + i), 20 + i * 1.6, 1.6);
}

function outpost(c: Ctx, x: number, z: number, wallMat = "wall") {
  bunker(c, x - 12, z - 6, false, wallMat);
  bunker(c, x + 12, z + 8, false, wallMat);
  sandbags(c, x - 4, z + 12, 8, false);
  sandbags(c, x + 4, z - 12, 8, false);
  sandbags(c, x + 14, z - 3, 7, true);
  sandbags(c, x - 14, z + 3, 7, true);
  tower(c, x, z - 2, 14);
  crate(c, x + 3, z + 4, 1.5); crate(c, x + 4.6, z + 4, 1.5, "trim"); crate(c, x + 3.8, z + 4, 1.4);
  barrelCluster(c, x - 6, z + 5, 3);
  lamp(c, x + 7, z - 7, 6);
}

// ---------------------------------------------------------------------------
// DESERT
// ---------------------------------------------------------------------------
function desert(tex: number, quality: number): MapData {
  const raw = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const dunes = (fbm2(x * 0.008 + 4, z * 0.008, 4) - 0.5) * 22 + Math.sin(x * 0.03 + fbm2(x * 0.01, z * 0.01, 3) * 7) * 1.6 + Math.sin(z * 0.045 + x * 0.01) * 0.9;
    const rim = sm(190, 290, d) * (28 + ridge2(x * 0.012 + 9, z * 0.012, 5) * 70);
    return dunes * 0.5 + rim;
  };
  return baseMap({
    id: "desert", name: "THE DESERT FRONTIER", sub: "KHARUN FLATS", seed: 11, tex, quality, raw,
    zones: [{ x: 0, z: 0, r: 40, f: 30 }],
    surface: (x, z, h) => (Math.hypot(x, z) > 215 || h > 22 ? "rock" : "sand"),
    terrain: {
      tile: 9, m1: "sand", m2: "rockStrata",
      blend: (x, z, _h, s) => Math.max(sm(0.08, 0.22, s) * 1.2, sm(205, 240, Math.hypot(x, z)) * 0.8, sm(0.55, 0.75, fbm2(x * 0.02, z * 0.02 + 5)) * 0.5),
      tint: (x, z, h) => { const v = 0.85 + fbm2(x * 0.01, z * 0.01, 3) * 0.3; const k = 0.9 + sm(-3, 6, h) * 0.2; return [v * k, v * k * 0.97, v * k * 0.93]; },
    },
    mats: (t) => {
      const M = commonMats(t, { wall: "whitePanel", wallTint: 0xd9c7a3, roof: "metal", rust: "corrugRust", stone: "rockStrata", dark: "darkMetal" });
      M.rock = pbrMat("rock", t);
      M.stone = pbrMat("rockStrata", t, { normal: 1.4 });
      M.sandstone = pbrMat("rockStrata", t, { color: 0xe0b890 });
      return M;
    },
    sky: {
      zenith: new THREE.Color(0.1, 0.32, 0.75).multiplyScalar(1.1), horizon: new THREE.Color(1.5, 1.0, 0.65), ground: new THREE.Color(0.9, 0.62, 0.42),
      sunDir: new THREE.Vector3(0.55, 0.36, -0.55), sunColor: new THREE.Color(3, 2.0, 1.1), sunDisc: 1,
      cloudCover: 0.22, cloudLit: new THREE.Color(1.8, 1.4, 1.0), cloudDark: new THREE.Color(0.6, 0.45, 0.4), cloudSpeed: 0.004,
      bodyDir: new THREE.Vector3(-0.6, 0.45, 0.5), bodySize: 0.16, bodyColor: new THREE.Color(1.5, 1.2, 0.9),
      body2Dir: new THREE.Vector3(-0.2, 0.28, 0.9), body2Size: 0.05, body2Color: new THREE.Color(0.9, 1.0, 1.3), haze: 0.5,
    },
    light: { sunColor: [1.0, 0.78, 0.52], intensity: 4.6, hemiSky: 0x9bb8e6, hemiGround: 0xb08658, hemiI: 0.45, fog: 0xc79b6c, fogDensity: 0.0042, env: 0.9, tint: [1.0, 0.85, 0.7] },
    grade: { exposure: 0.88, tint: [1.04, 0.98, 0.9], sat: 1.08, contrast: 1.08, bloom: [0.4, 1.3, 0.6], vignette: 0.35, godray: 0.55 },
    dust: [0.72, 0.56, 0.38], reverb: 0.12,
    weather: [{ kind: "dust", count: 3500, base: 0.35, cycle: 140 }], stormBase: 0.25,
    build: (c, { points, rnd }) => {
      // mesas on the perimeter
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
        const r = 205 + rnd() * 25;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const s = 14 + rnd() * 16;
        const y0 = c.w.heightAt(x, z);
        c.b.rock("stone", x, y0 + s * 0.4, z, s, s * (1.2 + rnd() * 1.0), s * 0.9, rnd() * 50, 3, 0.45);
        c.w.addCyl(x, z, s * 0.85, y0 - 3, y0 + s * 1.5, "rock", false);
      }
      // distant spires and structures on the rim
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2 + rnd() * 0.1;
        const r = 262 + rnd() * 30;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y0 = c.w.heightAt(x, z);
        const h = 12 + rnd() * 44;
        c.b.box("wall2", x, y0 + h / 2, z, 6 + rnd() * 10, h, 6 + rnd() * 10, a, 6);
        c.b.box("glowB", x, y0 + h * 0.8, z, 1, 0.4, 7, a);
      }
      militaryBase(c, -196, 1, "light");
      militaryBase(c, 196, -1, "dark");
      // A / E outposts
      outpost(c, points[0].x, points[0].z);
      outpost(c, points[4].x, points[4].z, "wall2");
      // B: ruined hangar + tank wrecks
      building(c, { x: points[1].x - 10, z: points[1].z + 4, sx: 24, sz: 16, h: 7, broken: true, doors: ["e"] });
      tankWreck(c, points[1].x + 12, points[1].z - 5, 0.5);
      tankWreck(c, points[1].x + 4, points[1].z + 14, 2.4);
      sandbags(c, points[1].x - 3, points[1].z - 12, 9, false);
      barrelCluster(c, points[1].x + 2, points[1].z, 4);
      // C: central command complex
      const C = points[2];
      building(c, { x: C.x, z: C.z, sx: 22, sz: 22, h: 8.5, doors: ["n", "s", "e", "w"], stairs: "e", wall: "wall" });
      tower(c, C.x - 20, C.z - 20, 30); tower(c, C.x + 20, C.z - 20, 26); tower(c, C.x - 20, C.z + 20, 26); tower(c, C.x + 20, C.z + 20, 30);
      dish(c, C.x, C.z + 30, 5.5);
      for (let i = 0; i < 4; i++) { sandbags(c, C.x - 28 + i * 18, C.z + 24, 8, false); sandbags(c, C.x - 28 + i * 18, C.z - 24, 8, false); }
      containerStack(c, C.x - 34, C.z, true, 2); containerStack(c, C.x + 34, C.z, true, 2); containerStack(c, C.x + 34, C.z + 8, true, 1);
      tankWreck(c, C.x - 12, C.z + 36, 1.2);
      barrelCluster(c, C.x + 14, C.z + 14, 3);
      // D: crashed gunship
      crashedShip(c, points[3].x + 4, points[3].z + 6, 0.4, 1);
      building(c, { x: points[3].x - 18, z: points[3].z - 10, sx: 16, sz: 12, h: 5.5, broken: true, doors: ["s"] });
      sandbags(c, points[3].x - 10, points[3].z + 16, 8, false);
      barrelCluster(c, points[3].x - 8, points[3].z + 4, 3);
      // random props
      for (let i = 0; i < 160; i++) {
        const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
        if (Math.hypot(x, z) > 225 || !free(c, x, z, 4)) continue;
        sandRock(c, x, z, 0.8 + rnd() * rnd() * 5.5, rnd() < 0.5 ? "stone" : "rock");
        c.avoid.push({ x, z, r: 3 });
      }
      for (let i = 0; i < 9; i++) {
        const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400;
        if (!free(c, x, z, 14) || Math.hypot(x, z) > 215) continue;
        tankWreck(c, x, z, rnd() * 6.28);
        c.avoid.push({ x, z, r: 8 });
      }
      for (let i = 0; i < 7; i++) {
        const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380;
        if (!free(c, x, z, 10)) continue;
        containerStack(c, x, z, rnd() < 0.5, 1 + Math.floor(rnd() * 2));
        containerStack(c, x + 3, z + (rnd() < 0.5 ? 3 : -3), rnd() < 0.5, 1);
        c.avoid.push({ x, z, r: 8 });
      }
      // power pylon line
      for (let i = 0; i < 9; i++) { const x = -200 + i * 50, z = -100 + Math.sin(i) * 10; if (free(c, x, z, 4)) tower(c, x, z, 20, 3); }
      for (let i = 0; i < 12; i++) { const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380; if (free(c, x, z, 6)) { barrelCluster(c, x, z, 2 + Math.floor(rnd() * 3)); } }
      // abandoned moisture vaporators
      for (let i = 0; i < 10; i++) {
        const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400;
        if (!free(c, x, z, 6) || Math.hypot(x, z) > 220) continue;
        const y0 = c.w.heightAt(x, z);
        c.b.cyl("wall2", x, y0 + 3.5, z, 0.45, 0.6, 7, 8, 3);
        c.b.cyl("trim", x, y0 + 7.4, z, 0.2, 1.1, 1.4, 8, 3);
        c.w.addCyl(x, z, 0.6, y0, y0 + 7, "metal", false);
        c.avoid.push({ x, z, r: 4 });
      }
      c.emitters.push({ x: -140, y: 20, z: -140, kind: "smoke", rate: 1.2, scale: 3, acc: 0 }, { x: 150, y: 20, z: 140, kind: "smoke", rate: 1.2, scale: 3, acc: 0 }, { x: -20, y: 14, z: 130, kind: "smoke", rate: 1, scale: 3, acc: 0 });
    },
  });
}

// ---------------------------------------------------------------------------
// INDUSTRIAL
// ---------------------------------------------------------------------------
function industrial(tex: number, quality: number): MapData {
  const raw = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    return (fbm2(x * 0.01 + 3, z * 0.01, 3) - 0.5) * 3 + sm(205, 285, d) * (40 + ridge2(x * 0.01, z * 0.01 + 8, 4) * 70);
  };
  return baseMap({
    id: "industrial", name: "THE INDUSTRIAL WARZONE", sub: "FORGE COMPLEX 9", seed: 29, tex, quality, raw,
    zones: [{ x: 0, z: 0, r: 60, f: 40 }],
    surface: (_x, _z, h) => (h > 8 ? "rock" : "concrete"),
    terrain: {
      tile: 7, m1: "concreteRaw", m2: "asphalt",
      blend: (x, z, _h, s) => Math.max(sm(0.55, 0.7, fbm2(x * 0.03, z * 0.03 + 11, 3)), sm(0.1, 0.25, s)),
      tint: (x, z) => { const v = 0.7 + fbm2(x * 0.05, z * 0.05, 4) * 0.5; return [v, v * 0.97, v * 0.93]; },
    },
    mats: (t) => {
      const M = commonMats(t, { wall: "metalRust", wallTint: 0xb0a8a0, roof: "corrugRust", rust: "metalRust", stone: "rockDark", floor: "concreteRaw" });
      M.rock = pbrMat("rockDark", t);
      M.pipe = pbrMat("metal", t, { color: 0x9a8a78 });
      M.pipe2 = pbrMat("metalRust", t, { color: 0xc0a090 });
      M.steel = pbrMat("darkMetal", t, { color: 0xb0b8c0 });
      return M;
    },
    sky: {
      zenith: new THREE.Color(0.22, 0.2, 0.22), horizon: new THREE.Color(1.0, 0.5, 0.28), ground: new THREE.Color(0.35, 0.2, 0.14),
      sunDir: new THREE.Vector3(-0.5, 0.2, 0.7), sunColor: new THREE.Color(3.2, 1.4, 0.6), sunDisc: 0.8,
      cloudCover: 0.85, cloudLit: new THREE.Color(1.4, 0.7, 0.4), cloudDark: new THREE.Color(0.15, 0.1, 0.1), cloudSpeed: 0.006,
      bodyDir: new THREE.Vector3(0.5, 0.5, -0.7), bodySize: 0.1, bodyColor: new THREE.Color(1.2, 0.8, 0.6), haze: 0.6,
    },
    light: { sunColor: [1.0, 0.62, 0.38], intensity: 3.6, hemiSky: 0x7c7068, hemiGround: 0x3a2c24, hemiI: 0.5, fog: 0x6b4a38, fogDensity: 0.0068, env: 0.85, tint: [0.9, 0.72, 0.6] },
    grade: { exposure: 1.05, tint: [1.06, 0.97, 0.9], sat: 1.05, contrast: 1.12, bloom: [0.6, 1.15, 0.7], vignette: 0.45, godray: 0.5 },
    dust: [0.38, 0.33, 0.3], reverb: 0.4,
    weather: [{ kind: "embers", count: 900, base: 0.8, cycle: 0 }], stormBase: 0.0, shake: 1.1,
    build: (c, { points, rnd }) => {
      // perimeter walls of the complex (industrial skyline)
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * Math.PI * 2;
        const r = 240 + rnd() * 20;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y0 = c.w.heightAt(x, z);
        const h = 20 + rnd() * 50;
        c.b.box("wall", x, y0 + h / 2, z, 14 + rnd() * 16, h, 12 + rnd() * 16, a, 6);
        if (rnd() < 0.7) c.b.box("glow", x * 0.98, y0 + h * (0.3 + rnd() * 0.5), z * 0.98, 6, 1, 0.4, a);
      }
      // giant stacks with flares
      for (const [x, z] of [[-90, -130], [100, -140], [-110, 135], [120, 140], [0, -170]] as [number, number][]) {
        const y0 = c.w.heightAt(x, z);
        c.b.cyl("pipe", x, y0 + 40, z, 3.4, 5.4, 80, 16, 8);
        for (let i = 0; i < 5; i++) c.b.cyl("hazard", x, y0 + 12 + i * 15, z, 5 - i * 0.35, 5 - i * 0.35, 0.8, 16, 2);
        c.w.addCyl(x, z, 5.4, y0 - 1, y0 + 80, "metal", false);
        c.emitters.push({ x, y: y0 + 80, z, kind: "flare", rate: 8, scale: 2.6, acc: 0 });
        c.emitters.push({ x, y: y0 + 82, z, kind: "smoke", rate: 3, scale: 4, acc: 0 });
        c.avoid.push({ x, z, r: 10 });
      }
      // bases
      militaryBase(c, -196, 1, "dark");
      militaryBase(c, 196, -1, "dark");
      // A: loading docks
      const A = points[0];
      building(c, { x: A.x - 10, z: A.z - 18, sx: 30, sz: 14, h: 8, doors: ["e", "s"], wall: "wall", stairs: "w" });
      for (let i = 0; i < 4; i++) containerStack(c, A.x + 6 + i * 3.6, A.z + 12, true, 1 + (i % 3));
      catwalk(c, A.x - 24, A.z + 6, A.x + 14, A.z + 6, 5.6, 3);
      stairs(c, A.x + 15.5, A.z + 6, "e", 0, 5.6, 2.8, "steel");
      crate(c, A.x, A.z - 4, 1.6);
      barrelCluster(c, A.x + 8, A.z - 8, 4);
      // B: pipe yard
      const Bp = points[1];
      for (let i = 0; i < 4; i++) {
        const z = Bp.z - 18 + i * 12;
        const y0 = c.w.heightAt(Bp.x, z);
        c.b.cyl("pipe", Bp.x, y0 + 1.6, z, 1.1, 1.1, 46, 12, 4, 0, Math.PI / 2, 0);
        for (let k = -1; k <= 1; k++) { c.b.box("trim", Bp.x + k * 16, y0 + 0.7, z, 0.6, 1.4, 2.6); }
        c.w.addBox(Bp.x, y0 + 1.1, z, 46, 2.2, 2.2, "metal", true);
      }
      storageTank(c, Bp.x - 28, Bp.z - 8, 7, 12, "pipe2");
      tankWreck(c, Bp.x + 20, Bp.z + 26, 0.8);
      barrelCluster(c, Bp.x + 6, Bp.z + 20, 4);
      // C: central refinery tower with elevated platform
      const C = points[2];
      const cy0 = c.w.heightAt(C.x, C.z);
      c.b.cyl("pipe", C.x, cy0 + 18, C.z, 6, 7.4, 36, 18, 6);
      for (let i = 0; i < 6; i++) c.b.cyl("trim", C.x, cy0 + 4 + i * 6, C.z, 7.6, 7.6, 0.6, 18, 3);
      c.w.addCyl(C.x, C.z, 7.4, cy0 - 1, cy0 + 36, "metal", false);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.78;
        const x = C.x + Math.cos(a) * 16, z = C.z + Math.sin(a) * 16;
        storageTank(c, x, z, 3.4, 9, "pipe");
        beam(c, "pipe2", C.x + Math.cos(a) * 7, cy0 + 8, C.z + Math.sin(a) * 7, x, cy0 + 8, z, 0.5, 8);
      }
      catwalk(c, C.x - 34, C.z - 20, C.x + 34, C.z - 20, 6.2, 3.4);
      catwalk(c, C.x - 34, C.z + 20, C.x + 34, C.z + 20, 6.2, 3.4);
      catwalk(c, C.x - 34, C.z - 20, C.x - 34, C.z + 20, 6.2, 3.4, false);
      catwalk(c, C.x + 34, C.z - 20, C.x + 34, C.z + 20, 6.2, 3.4, false);
      stairs(c, C.x - 35.7, C.z + 22, "s", 0, 6.2, 2.8, "steel");
      stairs(c, C.x + 35.7, C.z - 22, "n", 0, 6.2, 2.8, "steel");
      for (const [dx, dz] of [[-24, 8], [24, -8], [8, 26], [-10, -26]] as [number, number][]) { jersey(c, C.x + dx, C.z + dz, dx !== 0 && Math.abs(dx) > 20, 2); }
      barrelCluster(c, C.x + 12, C.z - 10, 3);
      c.emitters.push({ x: C.x + 4, y: cy0 + 36, z: C.z, kind: "smoke", rate: 3, scale: 3, acc: 0 });
      // D: container yard
      const D = points[3];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { if (r === 1 && k === 1) continue; containerStack(c, D.x - 14 + k * 9, D.z - 12 + r * 12, false, 1 + ((r + k) % 3)); }
      crashedShip(c, D.x + 24, D.z + 16, 1.2, 0.7);
      lamp(c, D.x, D.z, 10, "glow");
      // E: smelter
      const E = points[4];
      building(c, { x: E.x + 12, z: E.z + 20, sx: 26, sz: 16, h: 9, doors: ["n", "w"], wall: "wall" });
      storageTank(c, E.x - 14, E.z - 14, 6, 10, "pipe");
      storageTank(c, E.x - 14, E.z + 12, 5, 8, "pipe2");
      catwalk(c, E.x - 14, E.z - 14, E.x - 14, E.z + 12, 8, 2.6, false);
      for (let i = 0; i < 5; i++) c.emitters.push({ x: E.x - 3 + i * 3, y: c.w.heightAt(E.x, E.z) + 0.5, z: E.z - 6, kind: "steam", rate: 2, scale: 1.4, acc: 0 });
      c.emitters.push({ x: E.x, y: c.w.heightAt(E.x, E.z) + 1, z: E.z - 6, kind: "sparks", rate: 1.2, scale: 1, acc: 0 });
      // scattered industrial dressing
      for (let i = 0; i < 24; i++) {
        const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440;
        if (!free(c, x, z, 10) || Math.hypot(x, z) > 225) continue;
        containerStack(c, x, z, rnd() < 0.5, 1 + Math.floor(rnd() * 3));
        if (rnd() < 0.5) containerStack(c, x + (rnd() < 0.5 ? 6.5 : 0), z + 3, rnd() < 0.5, 1);
        c.avoid.push({ x, z, r: 8 });
      }
      // elevated pipe racks
      for (let r = 0; r < 4; r++) {
        const z0 = -150 + r * 80 + (rnd() - 0.5) * 20;
        const x0 = -180 + rnd() * 40;
        const len = 120 + rnd() * 60;
        if (!free(c, x0 + len / 2, z0, 10) && r % 2) continue;
        for (let k = 0; k <= len / 18; k++) {
          const x = x0 + k * 18;
          if (!free(c, x, z0, 6)) continue;
          const y0 = c.w.heightAt(x, z0);
          c.b.box("steel", x, y0 + 3, z0 - 2, 0.5, 6.4, 0.5, 0, 2);
          c.b.box("steel", x, y0 + 3, z0 + 2, 0.5, 6.4, 0.5, 0, 2);
          c.b.box("steel", x, y0 + 6.3, z0, 0.5, 0.5, 4.8, 0, 2);
          c.w.addBox(x, y0 + 3, z0 - 2, 0.6, 6, 0.6, "metal", false);
          c.w.addBox(x, y0 + 3, z0 + 2, 0.6, 6, 0.6, "metal", false);
        }
        for (let p = 0; p < 3; p++) {
          const y = c.w.heightAt(x0, z0) + 6.9 + p * 0.0;
          c.b.cyl(p % 2 ? "pipe" : "pipe2", x0 + len / 2, y, z0 - 1.4 + p * 1.4, 0.6, 0.6, len, 10, 4, 0, Math.PI / 2, 0);
        }
      }
      // gantry cranes
      for (const [x, z] of [[-60, 100], [60, -110], [-40, -110]] as [number, number][]) {
        if (!free(c, x, z, 10)) continue;
        const y0 = c.w.heightAt(x, z);
        for (const dx of [-10, 10]) { c.b.box("hazard", x + dx, y0 + 11, z, 1.2, 22, 1.2, 0, 3); c.w.addBox(x + dx, y0 + 11, z, 1.4, 22, 1.4, "metal", false); c.b.box("trim", x + dx, y0 + 0.5, z, 3, 1, 5); }
        c.b.box("hazard", x, y0 + 22.4, z, 22, 1.4, 2, 0, 3);
        c.b.box("trim", x, y0 + 20, z, 2, 4, 2);
        c.b.box("glow", x, y0 + 17.8, z, 0.8, 0.2, 0.8);
        c.avoid.push({ x, z, r: 14 });
      }
      for (let i = 0; i < 40; i++) { const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440; if (free(c, x, z, 3) && Math.hypot(x, z) < 225) { lamp(c, x, z, 8 + rnd() * 3, rnd() < 0.6 ? "glow" : "glowW", rnd() < 0.5 ? 1 : -1); c.avoid.push({ x, z, r: 2 }); } }
      for (let i = 0; i < 18; i++) { const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400; if (free(c, x, z, 5) && Math.hypot(x, z) < 225) { barrelCluster(c, x, z, 2 + Math.floor(rnd() * 3)); } }
      for (let i = 0; i < 14; i++) { const x = (rnd() - 0.5) * 420, z = (rnd() - 0.5) * 420; if (free(c, x, z, 4) && Math.hypot(x, z) < 225) { c.emitters.push({ x, y: c.w.heightAt(x, z) + 0.3, z, kind: i % 3 === 0 ? "sparks" : "steam", rate: 1.4, scale: 1.3, acc: 0 }); } }
      for (let i = 0; i < 40; i++) { const x = (rnd() - 0.5) * 440, z = (rnd() - 0.5) * 440; if (free(c, x, z, 3) && Math.hypot(x, z) < 225) { jersey(c, x, z, rnd() < 0.5, 2 + Math.floor(rnd() * 2)); c.avoid.push({ x, z, r: 3 }); } }
      for (let i = 0; i < 6; i++) { const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380; if (free(c, x, z, 14)) { tankWreck(c, x, z, rnd() * 6); c.avoid.push({ x, z, r: 8 }); } }
      for (let i = 0; i < 6; i++) { const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380; if (free(c, x, z, 12)) { storageTank(c, x, z, 3 + rnd() * 3, 6 + rnd() * 6, rnd() < 0.5 ? "pipe" : "pipe2"); } }
      for (let i = 0; i < 5; i++) { const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380; if (free(c, x, z, 16)) { building(c, { x, z, sx: 18 + rnd() * 10, sz: 12 + rnd() * 8, h: 6 + rnd() * 3, doors: ["n", "s"].slice(0, 1 + Math.floor(rnd() * 2)) as ("n" | "s")[], wall: "wall", broken: rnd() < 0.3 }); } }
      void column;
    },
  });
}

// ---------------------------------------------------------------------------
// JUNGLE
// ---------------------------------------------------------------------------
const riverZ = (x: number) => 52 * Math.sin(x / 62 + 1) + 20 * Math.sin(x / 23);

function jungle(tex: number, quality: number): MapData {
  const raw = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    let h = (fbm2(x * 0.011 + 7, z * 0.011, 4) - 0.5) * 30 + 5;
    const dr = Math.abs(z - riverZ(x));
    h = h * (1 - sm(18, 6, dr)) + -3.2 * sm(18, 6, dr);
    h += sm(200, 290, d) * (30 + ridge2(x * 0.012, z * 0.012 + 4, 4) * 60);
    return h;
  };
  const WL = -1.1;
  let water: THREE.Mesh | null = null;
  return baseMap({
    id: "jungle", name: "THE JUNGLE PLANET", sub: "VERDANT RIFT", seed: 53, tex, quality, raw,
    surface: (_x, _z, h) => (h < WL - 0.2 ? "water" : h < 1.2 ? "mud" : "grass"),
    terrain: {
      tile: 8, m1: "jungleFloor", m2: "mud",
      blend: (x, z, h) => Math.max(sm(1.8, 0.2, h), sm(0.6, 0.8, fbm2(x * 0.04, z * 0.04, 3)) * 0.8),
      tint: (x, z, _h) => { const v = 0.65 + fbm2(x * 0.02, z * 0.02 + 3, 3) * 0.7; return [v * 0.9, v, v * 0.8]; },
      normalScale: 1.2,
    },
    mats: (t) => {
      const M = commonMats(t, { wall: "stoneMoss", wallTint: 0xe0e8d0, roof: "stoneMoss", rust: "metalRust", stone: "stoneMoss", wood: "wood", floor: "stoneMoss" });
      M.bark = pbrMat("bark", t);
      M.leaf = foliageMat("broad", 0xc8e8b0);
      M.leaf2 = foliageMat("broad", 0xa0d890);
      M.fern = foliageMat("fern", 0xd0f0c0);
      M.grassCard = foliageMat("grass", 0xc8e8b0);
      M.rock = pbrMat("rockDark", t, { color: 0x9aa08c });
      return M;
    },
    sky: {
      zenith: new THREE.Color(0.18, 0.5, 0.85), horizon: new THREE.Color(0.85, 1.05, 0.95), ground: new THREE.Color(0.28, 0.4, 0.34),
      sunDir: new THREE.Vector3(0.35, 0.62, -0.5), sunColor: new THREE.Color(3, 2.5, 1.7), sunDisc: 1,
      cloudCover: 0.5, cloudLit: new THREE.Color(1.6, 1.6, 1.5), cloudDark: new THREE.Color(0.5, 0.6, 0.65), cloudSpeed: 0.007,
      bodyDir: new THREE.Vector3(-0.5, 0.35, 0.8), bodySize: 0.22, bodyColor: new THREE.Color(0.9, 1.1, 1.5), haze: 0.4,
    },
    light: { sunColor: [1.0, 0.92, 0.72], intensity: 4.4, hemiSky: 0x9fd0c0, hemiGround: 0x3a4a28, hemiI: 0.6, fog: 0x7fa592, fogDensity: 0.0072, env: 0.8, tint: [0.7, 0.85, 0.7] },
    grade: { exposure: 1.0, tint: [0.98, 1.04, 0.98], sat: 1.12, contrast: 1.06, bloom: [0.4, 1.25, 0.7], vignette: 0.4, godray: 0.5 },
    dust: [0.3, 0.24, 0.16], reverb: 0.3,
    weather: [{ kind: "spores", count: 700, base: 1, cycle: 0 }, { kind: "rain", count: 2600, base: 0, cycle: 160 }], stormBase: 0, shake: 1,
    build: (c, { points, rnd }) => {
      const topY = (x: number, z: number) => c.w.heightAt(x, z);
      const isLand = (x: number, z: number) => topY(x, z) > WL + 0.6;
      // ---- trees
      let big = 0;
      for (let i = 0; i < 1000 && big < (quality > 0.7 ? 230 : 150); i++) {
        const x = (rnd() - 0.5) * 520, z = (rnd() - 0.5) * 520;
        if (Math.hypot(x, z) > 260 || !isLand(x, z) || !free(c, x, z, 4)) continue;
        const giant = rnd() < 0.06;
        const y0 = topY(x, z);
        const h = giant ? 44 + rnd() * 14 : 15 + rnd() * 14;
        const rb = giant ? 2.8 + rnd() : 0.7 + rnd() * 0.6;
        c.b.cyl("bark", x, y0 + h / 2 - 1, z, rb * 0.55, rb, h + 2, 9, 6);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * 6.28 + rnd();
          const rr = rb * 1.7;
          const g = new THREE.CylinderGeometry(0.05, rb * 0.5, rb * 4, 5);
          c.b.place(g, "bark", x + Math.cos(a) * rb * 0.9, y0 + rb * 1.5 - 0.5, z + Math.sin(a) * rb * 0.9, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5, 1, 1, 1, 0.5);
          void rr;
        }
        c.w.addCyl(x, z, rb * 0.95, y0 - 1, y0 + h, "wood", false);
        if (rb > 1.4) c.cover.push({ x: x + rb + 1, z }, { x: x - rb - 1, z }, { x, z: z + rb + 1 }, { x, z: z - rb - 1 });
        c.avoid.push({ x, z, r: rb + 1.6 });
        // canopy
        const nCan = giant ? 16 : 7;
        for (let k = 0; k < nCan; k++) {
          const a = rnd() * 6.28, rad = (giant ? 5 + rnd() * 12 : 2 + rnd() * 5);
          const ch = h * (giant ? 0.7 + rnd() * 0.35 : 0.72 + rnd() * 0.35);
          const sz = giant ? 14 + rnd() * 8 : 7 + rnd() * 5;
          c.b.card(rnd() < 0.5 ? "leaf" : "leaf2", x + Math.cos(a) * rad, y0 + ch, z + Math.sin(a) * rad, sz, sz * 0.8, rnd() * 3.14, (rnd() - 0.5) * 0.5);
          c.b.card("leaf", x + Math.cos(a) * rad * 0.6, y0 + ch - 2, z + Math.sin(a) * rad * 0.6, sz * 0.8, sz * 0.7, rnd() * 3.14, (rnd() - 0.5) * 0.7);
        }
        // hanging vines
        if (rnd() < 0.5) for (let k = 0; k < 3; k++) { const a = rnd() * 6.28; const r2 = 2 + rnd() * 3; beam(c, "bark", x + Math.cos(a) * r2, y0 + h * 0.8, z + Math.sin(a) * r2, x + Math.cos(a) * r2 * 1.1, y0 + h * 0.4, z + Math.sin(a) * r2 * 1.1, 0.06, 4); }
        big++;
      }
      // ---- understory
      for (let i = 0; i < (quality > 0.7 ? 1100 : 500); i++) {
        const x = (rnd() - 0.5) * 500, z = (rnd() - 0.5) * 500;
        if (Math.hypot(x, z) > 255 || !isLand(x, z)) continue;
        const y0 = topY(x, z);
        const k = rnd();
        if (k < 0.45) c.b.card("fern", x, y0 - 0.1, z, 2.6 + rnd() * 1.5, 2 + rnd(), rnd() * 3, (rnd() - 0.5) * 0.2);
        else if (k < 0.8) c.b.card("grassCard", x, y0 - 0.05, z, 1.8 + rnd(), 1.2 + rnd() * 0.8, rnd() * 3);
        else c.b.card("leaf2", x, y0 - 0.2, z, 3 + rnd() * 2, 2.5 + rnd() * 1.5, rnd() * 3, (rnd() - 0.5) * 0.3);
      }
      // ---- boulders
      for (let i = 0; i < 70; i++) {
        const x = (rnd() - 0.5) * 480, z = (rnd() - 0.5) * 480;
        if (Math.hypot(x, z) > 240 || !isLand(x, z) || !free(c, x, z, 3)) continue;
        sandRock(c, x, z, 1 + rnd() * rnd() * 5, "rock");
        c.avoid.push({ x, z, r: 3 });
      }
      // ---- bases
      const jbase = (cx: number, f: number) => {
        building(c, { x: cx - f * 10, z: -22, sx: 24, sz: 14, h: 5.6, wall: "wall", doors: ["e", "w"], stairs: "n" });
        building(c, { x: cx - f * 10, z: 22, sx: 24, sz: 14, h: 5.6, wall: "wall", doors: ["e", "w"], stairs: "s" });
        tower(c, cx + f * 8, 0, 26);
        dish(c, cx - f * 8, 0, 4);
        for (let i = 0; i < 5; i++) { sandbags(c, cx + f * 30, -24 + i * 12, 8, true); }
        for (let i = 0; i < 4; i++) containerStack(c, cx - f * 28, -22 + i * 15, true, 1 + (i % 2));
        barrelCluster(c, cx + f * 14, -10, 3);
        lamp(c, cx + f * 20, -30, 8, "glowW", -f); lamp(c, cx + f * 20, 30, 8, "glowW", -f);
      };
      jbase(-196, 1);
      jbase(196, -1);
      // ---- A: wooden stilt outpost
      const A = points[0];
      const woodDeck = (x: number, z: number, sx: number, sz: number, y: number) => {
        c.b.box("wood", x, y - 0.15, z, sx, 0.3, sz, 0, 2);
        c.w.addBox(x, y - 0.15, z, sx, 0.3, sz, "wood", true);
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const px = x + dx * (sx / 2 - 0.4), pz = z + dz * (sz / 2 - 0.4);
          const gy = topY(px, pz);
          c.b.cyl("bark", px, (gy + y) / 2, pz, 0.28, 0.32, Math.max(0.5, y - gy), 8, 3);
          c.w.addCyl(px, pz, 0.32, gy, y, "wood", false);
        }
        for (const s of [-1, 1]) { c.b.box("wood", x + s * (sx / 2 - 0.1), y + 0.5, z, 0.12, 1, sz, 0, 2); c.b.box("wood", x, y + 0.5, z + s * (sz / 2 - 0.1), sx, 1, 0.12, 0, 2); }
      };
      const y3 = Math.max(topY(A.x, A.z) + 3.4, 3);
      woodDeck(A.x, A.z, 14, 12, y3);
      stairs(c, A.x + 7, A.z, "e", topY(A.x + 8, A.z), y3 - topY(A.x + 8, A.z) + 0.2, 2.4, "wood");
      woodDeck(A.x - 16, A.z + 6, 8, 8, y3 - 0.5);
      beam(c, "fabric", A.x - 12, y3 - 0.5 + 0.1, A.z + 6, A.x - 7, y3 + 0.1, A.z + 3, 0.08, 4);
      sandbags(c, A.x + 12, A.z - 12, 8, false); sandbags(c, A.x - 10, A.z - 14, 8, false);
      barrelCluster(c, A.x + 4, A.z + 12, 3);
      crate(c, A.x, A.z, 1.5, "wood");
      // ---- B: ruins courtyard
      const Bp = points[1];
      building(c, { x: Bp.x - 14, z: Bp.z - 12, sx: 16, sz: 12, h: 7, wall: "wall", broken: true, doors: ["e"] });
      building(c, { x: Bp.x + 16, z: Bp.z + 8, sx: 14, sz: 14, h: 6, wall: "wall", broken: true, doors: ["w"] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.28;
        const px = Bp.x + Math.cos(a) * 12, pz = Bp.z + Math.sin(a) * 12;
        const y0 = topY(px, pz);
        const hh = 3 + rnd() * 4;
        c.b.cyl("wall", px, y0 + hh / 2 - 0.3, pz, 0.8, 0.95, hh, 8, 3);
        c.w.addCyl(px, pz, 0.95, y0 - 0.5, y0 + hh, "rock", false);
      }
      for (let i = 0; i < 6; i++) { const px = Bp.x + (rnd() - 0.5) * 30, pz = Bp.z + (rnd() - 0.5) * 30; block(c, "wall", px, topY(px, pz) - 0.3, pz, 2 + rnd() * 2, 0.8 + rnd() * 1.2, 2 + rnd() * 2, "rock", true, 2); }
      barrelCluster(c, Bp.x + 2, Bp.z + 2, 3);
      // ---- C: stepped temple
      const C = points[2];
      const cy = topY(C.x, C.z);
      const tiers = [40, 32, 24, 16];
      tiers.forEach((s, i) => { block(c, "wall", C.x, cy + i * 2.4 - (i === 0 ? 1.5 : 0), C.z, s, 2.4 + (i === 0 ? 1.5 : 0), s, "rock", true, 4, false); });
      const top = cy + tiers.length * 2.4;
      stairs(c, C.x + 8.0, C.z, "e", cy, 2.4 * 4 - 0.4, 6, "wall", 1.0);
      block(c, "wall", C.x, top, C.z, 11, 0.4, 11, "rock", true, 3, false);
      for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) column(c, "wall", C.x + dx, C.z + dz, 0.7, top + 0.4, 5, "rock", 10);
      block(c, "wall", C.x, top + 5.4, C.z, 11.5, 0.8, 11.5, "rock", true, 3, false);
      // approach stairs on west/north/south via smaller stairs
      for (const d of ["w", "n", "s"] as const) {
        const ox = d === "w" ? C.x - 20 : C.x, oz = d === "n" ? C.z - 20 : d === "s" ? C.z + 20 : C.z;
        stairs(c, ox + (d === "w" ? -0.0 : 0), oz, d === "w" ? "w" : d === "n" ? "n" : "s", cy - 0.0, 2.4, 6, "wall", 1.0);
      }
      c.emitters.push({ x: C.x + 4, y: top + 1, z: C.z, kind: "fire", rate: 2, scale: 0.8, acc: 0 });
      // ---- D: crashed freighter
      const D = points[3];
      crashedShip(c, D.x - 6, D.z - 4, 0.9, 1.15);
      sandbags(c, D.x + 12, D.z + 8, 9, false);
      barrelCluster(c, D.x + 4, D.z + 6, 3);
      // ---- E: tree house outpost
      const E = points[4];
      const y4 = Math.max(topY(E.x, E.z) + 4, 4);
      woodDeck(E.x, E.z, 14, 14, y4);
      stairs(c, E.x - 7, E.z, "w", topY(E.x - 8, E.z), y4 - topY(E.x - 8, E.z) + 0.2, 2.4, "wood");
      building(c, { x: E.x + 18, z: E.z - 14, sx: 14, sz: 10, h: 5, wall: "wall", doors: ["w"] });
      sandbags(c, E.x - 14, E.z + 14, 8, false);
      barrelCluster(c, E.x + 6, E.z + 14, 3);
      // shot-down walker/wrecks
      for (let i = 0; i < 6; i++) { const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380; if (isLand(x, z) && free(c, x, z, 14)) { tankWreck(c, x, z, rnd() * 6); c.avoid.push({ x, z, r: 8 }); } }
      for (let i = 0; i < 10; i++) { const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400; if (isLand(x, z) && free(c, x, z, 6)) { barrelCluster(c, x, z, 2); } }
      // river stepping logs
      for (let i = 0; i < 9; i++) {
        const x = -200 + i * 48 + rnd() * 10;
        const z = riverZ(x) + (rnd() - 0.5) * 6;
        const y0 = WL + 0.35;
        c.b.cyl("bark", x, y0, z, 0.7, 0.7, 20, 8, 4, 0, 0, Math.PI / 2 + 0.0, false);
        c.w.addBox(x, y0, z, 1.2, 1.0, 1.2, "wood", true);
        c.b.cyl("bark", x, y0 + 0.4, z, 0.8, 0.8, 8, 8, 4, Math.PI / 2, 0, 0);
        c.w.addBox(x, y0 + 0.2, z, 1.4, 0.8, 8, "wood", true);
      }
    },
    extra: (c, group) => {
      // water
      const wn = getPBR("waterNormal", tex);
      wn.normalMap.repeat.set(120, 120);
      const wm = new THREE.MeshPhysicalMaterial({ color: 0x1d5a52, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86, normalMap: wn.normalMap, envMapIntensity: 2.4, clearcoat: 1, clearcoatRoughness: 0.05 });
      wm.normalScale.set(0.55, 0.55);
      water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 1, 1), wm);
      water.rotation.x = -Math.PI / 2;
      water.position.y = WL;
      water.receiveShadow = true;
      group.add(water);
      c.anim.push((t) => { wn.normalMap.offset.set(t * 0.012, t * 0.007); });
      // light shafts (god ray cards)
      const gc = document.createElement("canvas");
      gc.width = 64; gc.height = 256;
      const g = gc.getContext("2d")!;
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, "rgba(255,255,255,0.9)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
      const gh = g.createLinearGradient(0, 0, 64, 0);
      gh.addColorStop(0, "rgba(0,0,0,1)"); gh.addColorStop(0.5, "rgba(0,0,0,0)"); gh.addColorStop(1, "rgba(0,0,0,1)");
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = gh; g.fillRect(0, 0, 64, 256);
      const gt = new THREE.CanvasTexture(gc);
      const sm2 = new THREE.MeshBasicMaterial({ map: gt, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.4, 0.8), toneMapped: false, fog: true });
      const rnd2 = mulberry32(99);
      const shafts: THREE.Mesh[] = [];
      for (let i = 0; i < 34; i++) {
        const x = (rnd2() - 0.5) * 360, z = (rnd2() - 0.5) * 360;
        const y = c.w.heightAt(x, z);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(5 + rnd2() * 5, 34), sm2);
        m.position.set(x, y + 14, z);
        m.rotation.y = rnd2() * 3.14;
        m.rotation.z = 0.25;
        m.renderOrder = 9;
        m.frustumCulled = true;
        group.add(m);
        shafts.push(m);
      }
      c.anim.push((t) => { sm2.opacity = 0.06 + Math.sin(t * 0.4) * 0.02; });
    },
  });
}

// ---------------------------------------------------------------------------
// FROZEN
// ---------------------------------------------------------------------------
function frozen(tex: number, quality: number): MapData {
  const LAKE = { x: -58, z: 95, r: 52 };
  const raw = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    let h = (fbm2(x * 0.009 + 2, z * 0.009, 4) - 0.5) * 14 + Math.sin(x * 0.05 + z * 0.03) * 0.6;
    h += sm(190, 280, d) * (36 + ridge2(x * 0.011 + 3, z * 0.011, 5) * 80);
    return h;
  };
  return baseMap({
    id: "frozen", name: "THE FROZEN BATTLEFIELD", sub: "GLACIER STATION KAPPA", seed: 77, tex, quality, raw,
    zones: [{ ...LAKE, f: 18, fixH: -0.8 }],
    surface: (x, z) => (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4 ? "ice" : "snow"),
    terrain: {
      tile: 8, m1: "snowRough", m2: "iceCliff",
      blend: (x, z, _h, s) => Math.max(sm(LAKE.r + 8, LAKE.r - 6, Math.hypot(x - LAKE.x, z - LAKE.z)), sm(0.1, 0.24, s)),
      tint: (x, z) => { const v = 0.88 + fbm2(x * 0.02, z * 0.02, 3) * 0.2; return [v * 0.95, v, v * 1.05]; },
      normalScale: 0.9,
    },
    mats: (t) => {
      const M = commonMats(t, { wall: "whitePanel", wallTint: 0xdfe8f0, roof: "whitePanel", rust: "metal", stone: "rockDark", floor: "concrete" });
      M.ice = new THREE.MeshPhysicalMaterial({ color: 0x9fd4ee, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.8, clearcoat: 1, envMapIntensity: 2.2, normalMap: getPBR("iceCliff", t).normalMap, ior: 1.31 });
      M.iceSolid = pbrMat("iceCliff", t, { env: 1.8 });
      M.snow = pbrMat("snow", t);
      M.rock = pbrMat("rockDark", t);
      M.pine = foliageMat("pine", 0xb8d8c0);
      M.bark = pbrMat("bark", t, { color: 0x887766 });
      return M;
    },
    sky: {
      zenith: new THREE.Color(0.12, 0.3, 0.7), horizon: new THREE.Color(0.95, 1.1, 1.35), ground: new THREE.Color(0.7, 0.78, 0.9),
      sunDir: new THREE.Vector3(-0.6, 0.22, -0.6), sunColor: new THREE.Color(2.4, 2.3, 2.3), sunDisc: 0.9,
      cloudCover: 0.45, cloudLit: new THREE.Color(1.6, 1.7, 1.9), cloudDark: new THREE.Color(0.6, 0.7, 0.85), cloudSpeed: 0.008,
      bodyDir: new THREE.Vector3(0.5, 0.4, 0.6), bodySize: 0.28, bodyColor: new THREE.Color(0.8, 1.0, 1.5),
      body2Dir: new THREE.Vector3(0.8, 0.2, 0.5), body2Size: 0.04, body2Color: new THREE.Color(1.4, 1.2, 1.0), haze: 0.5,
    },
    light: { sunColor: [0.85, 0.92, 1.0], intensity: 4.0, hemiSky: 0xb8d4ff, hemiGround: 0xd8e4f4, hemiI: 0.7, fog: 0xaabbd0, fogDensity: 0.0075, env: 1.0, tint: [0.9, 0.95, 1.05] },
    grade: { exposure: 0.95, tint: [0.95, 1.0, 1.08], sat: 0.98, contrast: 1.07, bloom: [0.35, 1.6, 0.6], vignette: 0.38, godray: 0.45 },
    dust: [0.9, 0.93, 1], reverb: 0.15, snowy: true,
    weather: [{ kind: "snow", count: 5000, base: 0.55, cycle: 120 }], stormBase: 0.3,
    build: (c, { points, rnd }) => {
      const topY = (x: number, z: number) => c.w.heightAt(x, z);
      // ice spires & glacial formations around the rim
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
        const r = 205 + rnd() * 22;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y0 = topY(x, z);
        const s = 12 + rnd() * 14;
        c.b.rock("rock", x, y0 + s * 0.4, z, s, s * (1.1 + rnd()), s, rnd() * 50, 3, 0.45);
        c.b.rock("snow", x, y0 + s * 1.2, z, s * 0.85, s * 0.35, s * 0.85, rnd() * 50, 2, 0.35);
        c.w.addCyl(x, z, s * 0.85, y0 - 3, y0 + s * 1.5, "rock", false);
      }
      // ice crystals clusters
      const crystals = (x: number, z: number, n: number, s: number) => {
        const y0 = topY(x, z);
        for (let i = 0; i < n; i++) {
          const a = rnd() * 6.28, d = rnd() * s * 1.4;
          const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
          const h = s * (1.5 + rnd() * 2.5);
          const g = new THREE.ConeGeometry(s * (0.25 + rnd() * 0.3), h, 5);
          c.b.place(g, "ice", px, topY(px, pz) + h / 2 - 0.3, pz, (rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.4, 1, 1, 1, 1);
        }
        c.w.addCyl(x, z, s * 0.9, y0 - 1, y0 + s * 2.2, "ice", false);
        c.cover.push({ x: x + s + 1.5, z }, { x: x - s - 1.5, z }, { x, z: z + s + 1.5 }, { x, z: z - s - 1.5 });
      };
      for (let i = 0; i < 26; i++) {
        const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
        if (Math.hypot(x, z) > 225 || !free(c, x, z, 6)) continue;
        crystals(x, z, 3 + Math.floor(rnd() * 4), 1.3 + rnd() * 1.6);
        c.avoid.push({ x, z, r: 5 });
      }
      // snow-capped boulders
      for (let i = 0; i < 80; i++) {
        const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
        if (Math.hypot(x, z) > 230 || !free(c, x, z, 3)) continue;
        const s = 1 + rnd() * rnd() * 5;
        sandRock(c, x, z, s, "rock");
        const y0 = topY(x, z);
        c.b.rock("snow", x, y0 + s * 0.75, z, s * 0.85, s * 0.3, s * 0.85, rnd() * 20, 2, 0.3);
        c.avoid.push({ x, z, r: 3 });
      }
      // pine trees
      for (let i = 0; i < (quality > 0.7 ? 160 : 90); i++) {
        const x = (rnd() - 0.5) * 480, z = (rnd() - 0.5) * 480;
        if (Math.hypot(x, z) > 235 || !free(c, x, z, 3) || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 6) continue;
        const y0 = topY(x, z);
        const h = 9 + rnd() * 9;
        c.b.cyl("bark", x, y0 + h * 0.3, z, 0.25, 0.45, h * 0.6, 7, 4);
        for (let k = 0; k < 5; k++) {
          const f = k / 5;
          const rr = (3.2 - f * 2.2) * (h / 13);
          c.b.cyl("pine", x, y0 + h * (0.28 + f * 0.65), z, 0.1, rr, h * 0.3, 9, 4);
          c.b.cyl("snow", x, y0 + h * (0.32 + f * 0.65), z, 0.1, rr * 0.82, h * 0.2, 9, 4);
        }
        c.w.addCyl(x, z, 0.5, y0 - 0.5, y0 + h, "wood", false);
        c.avoid.push({ x, z, r: 1.8 });
      }
      // bases (white)
      militaryBase(c, -196, 1, "light");
      militaryBase(c, 196, -1, "dark");
      // A: trench outpost
      const A = points[0];
      outpost(c, A.x, A.z);
      for (let i = 0; i < 4; i++) { const px = A.x - 20 + i * 12; block(c, "snow", px, topY(px, A.z - 16) - 0.3, A.z - 16, 10, 1.6, 2.2, "snow", true, 3); }
      // B: ice arch cave
      const Bp = points[1];
      crystals(Bp.x - 14, Bp.z - 4, 6, 3.4);
      crystals(Bp.x + 14, Bp.z + 6, 6, 3.4);
      crystals(Bp.x, Bp.z - 18, 4, 2.6);
      const by0 = topY(Bp.x, Bp.z);
      block(c, "iceSolid", Bp.x, by0 + 5.4, Bp.z, 26, 2.4, 8, "ice", true, 4, false);
      block(c, "iceSolid", Bp.x - 11, by0 - 0.5, Bp.z, 4, 6.2, 8, "ice", false, 4);
      block(c, "iceSolid", Bp.x + 11, by0 - 0.5, Bp.z, 4, 6.2, 8, "ice", false, 4);
      tankWreck(c, Bp.x + 4, Bp.z + 20, 0.4);
      barrelCluster(c, Bp.x - 4, Bp.z + 8, 3);
      // C: shield generator complex
      const C = points[2];
      const cy = topY(C.x, C.z);
      building(c, { x: C.x - 16, z: C.z - 4, sx: 18, sz: 14, h: 6, wall: "wall", doors: ["e", "s"], stairs: "w" });
      building(c, { x: C.x + 16, z: C.z + 6, sx: 18, sz: 14, h: 6, wall: "wall", doors: ["w", "n"], stairs: "e" });
      c.b.cyl("wall", C.x, cy + 6, C.z, 3, 4.2, 12, 16, 4);
      c.b.sphere("trim", C.x, cy + 13, C.z, 3.6, 0.85, 3);
      c.b.cyl("glowB", C.x, cy + 8, C.z, 3.05, 3.05, 1.2, 16, 4);
      c.b.cyl("glowB", C.x, cy + 11, C.z, 2.7, 2.7, 0.5, 16, 4);
      c.w.addCyl(C.x, C.z, 4.2, cy - 1, cy + 14, "metal", false);
      c.emitters.push({ x: C.x, y: cy + 15, z: C.z, kind: "sparks", rate: 1.5, scale: 1, acc: 0 });
      for (const [dx, dz] of [[-9, 20], [9, -20], [-30, 10], [30, -10]] as [number, number][]) { tower(c, C.x + dx, C.z + dz, 18, 2.4); }
      for (let i = 0; i < 4; i++) { sandbags(c, C.x - 16 + i * 11, C.z + 24, 8, false); sandbags(c, C.x - 16 + i * 11, C.z - 22, 8, false); }
      // D: radar station
      const D = points[3];
      dish(c, D.x, D.z, 8);
      dish(c, D.x - 22, D.z - 12, 4.5);
      building(c, { x: D.x + 18, z: D.z - 10, sx: 16, sz: 12, h: 5.2, wall: "wall", doors: ["w"] });
      containerStack(c, D.x - 10, D.z + 18, false, 2);
      crashedShip(c, D.x + 12, D.z + 22, 2.2, 0.8);
      barrelCluster(c, D.x + 4, D.z + 4, 3);
      // E: hangar
      const E = points[4];
      building(c, { x: E.x + 4, z: E.z - 14, sx: 30, sz: 18, h: 8, wall: "wall", doors: ["s", "w"], stairs: "e" });
      storageTank(c, E.x - 16, E.z + 10, 5, 8, "wall");
      storageTank(c, E.x - 16, E.z + 22, 4, 6, "wall");
      sandbags(c, E.x - 4, E.z + 14, 9, false);
      barrelCluster(c, E.x + 8, E.z + 10, 4);
      // frozen lake dressing — wrecked walker + cracks
      tankWreck(c, LAKE.x + 8, LAKE.z - 10, 1.0);
      crashedShip(c, LAKE.x - 20, LAKE.z + 14, 0.3, 0.8);
      // generic dressing
      for (let i = 0; i < 8; i++) { const x = (rnd() - 0.5) * 420, z = (rnd() - 0.5) * 420; if (free(c, x, z, 14) && Math.hypot(x, z) < 225) { tankWreck(c, x, z, rnd() * 6); c.avoid.push({ x, z, r: 8 }); } }
      for (let i = 0; i < 6; i++) { const x = (rnd() - 0.5) * 420, z = (rnd() - 0.5) * 420; if (free(c, x, z, 10) && Math.hypot(x, z) < 225) { containerStack(c, x, z, rnd() < 0.5, 1 + Math.floor(rnd() * 2)); c.avoid.push({ x, z, r: 7 }); } }
      for (let i = 0; i < 12; i++) { const x = (rnd() - 0.5) * 420, z = (rnd() - 0.5) * 420; if (free(c, x, z, 5) && Math.hypot(x, z) < 225) { sandbags(c, x, z, 7, rnd() < 0.5); c.avoid.push({ x, z, r: 4 }); } }
      for (let i = 0; i < 12; i++) { const x = (rnd() - 0.5) * 420, z = (rnd() - 0.5) * 420; if (free(c, x, z, 5) && Math.hypot(x, z) < 225) { barrelCluster(c, x, z, 2 + Math.floor(rnd() * 2)); } }
      for (let i = 0; i < 5; i++) { const x = (rnd() - 0.5) * 380, z = (rnd() - 0.5) * 380; if (free(c, x, z, 16) && Math.hypot(x, z) < 220) { building(c, { x, z, sx: 14 + rnd() * 8, sz: 10 + rnd() * 6, h: 5, doors: ["n", "s"].slice(0, 1 + Math.floor(rnd() * 2)) as ("n" | "s")[], wall: "wall", broken: rnd() < 0.4 }); } }
      for (let i = 0; i < 10; i++) { const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400; if (free(c, x, z, 3) && Math.hypot(x, z) < 225) { lamp(c, x, z, 7, "glowW", rnd() < 0.5 ? 1 : -1); c.avoid.push({ x, z, r: 2 }); } }
      c.emitters.push({ x: -150, y: 3, z: -120, kind: "smoke", rate: 1, scale: 2, acc: 0 }, { x: 140, y: 3, z: 100, kind: "smoke", rate: 1, scale: 2, acc: 0 });
      void noise2; void container;
    },
  });
}

export function buildMap(id: MapId, texSize: number, quality: number): MapData {
  switch (id) {
    case "desert": return desert(texSize, quality);
    case "industrial": return industrial(texSize, quality);
    case "jungle": return jungle(texSize, quality);
    default: return frozen(texSize, quality);
  }
}

export const MAP_INFO: Record<MapId, { name: string; sub: string; desc: string; colors: [string, string] }> = {
  desert: { name: "THE DESERT FRONTIER", sub: "KHARUN FLATS", desc: "Sandstorms sweep across a scarred wasteland of burnt-out armour, abandoned outposts and sprawling military bases beneath twin moons.", colors: ["#e8a85a", "#6b3a1e"] },
  industrial: { name: "THE INDUSTRIAL WARZONE", sub: "FORGE COMPLEX 9", desc: "Towering refinery stacks, catwalk bridges and burning flares. Fight through pipe yards and container docks under a smog-choked sky.", colors: ["#ff7a3a", "#2a1810"] },
  jungle: { name: "THE JUNGLE PLANET", sub: "VERDANT RIFT", desc: "Giant trees, mist and sunbeams. Contest ancient ruins, a winding river and wrecked starships in dense tropical growth.", colors: ["#6fd08a", "#12331f"] },
  frozen: { name: "THE FROZEN BATTLEFIELD", sub: "GLACIER STATION KAPPA", desc: "Blizzards lash a frozen research installation. Fight across ice lakes, crystal caverns and snow-buried trenches.", colors: ["#a8d8ff", "#1c2f4a"] },
};
