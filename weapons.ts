import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WeaponSound } from "./audio";
import type { ClassId } from "./types";
import { getPBR } from "./textures";

export interface WeaponDef {
  id: WeaponSound;
  name: string;
  kind: string;
  auto: boolean;
  rpm: number;
  dmg: number;
  head: number;
  falloff: [number, number, number];
  mag: number;
  reserve: number;
  reload: number;
  spread: number; // hip degrees
  adsSpread: number;
  perShot: number;
  maxSpread: number;
  recoilP: number;
  recoilY: number;
  speed: number;
  pellets: number;
  energy: boolean;
  heat: number;
  cool: number;
  bolt: [[number, number, number], [number, number, number]];
  boltLen: number;
  boltThick: number;
  zoom: number;
  scope: boolean;
  moveMul: number;
  muzzle: number;
  aiRange: number;
  muzzlePos: [number, number, number];
  kick: number;
}

export const WEAPONS: Record<WeaponSound, WeaponDef> = {
  ar7: { id: "ar7", name: "AR-7 VANGUARD", kind: "ASSAULT RIFLE", auto: true, rpm: 620, dmg: 21, head: 1.8, falloff: [40, 95, 0.6], mag: 30, reserve: 180, reload: 2.0, spread: 1.0, adsSpread: 0.3, perShot: 0.2, maxSpread: 3.2, recoilP: 0.55, recoilY: 0.28, speed: 160, pellets: 1, energy: false, heat: 0, cool: 0, bolt: [[0.5, 1.3, 4.5], [4.5, 0.35, 0.25]], boltLen: 2.4, boltThick: 1, zoom: 1.45, scope: false, moveMul: 1, muzzle: 0.55, aiRange: 70, muzzlePos: [0, 0.03, -0.72], kick: 0.03 },
  hr9: { id: "hr9", name: "HR-9 BASALT", kind: "HEAVY RIFLE", auto: true, rpm: 340, dmg: 38, head: 1.7, falloff: [50, 110, 0.65], mag: 24, reserve: 120, reload: 2.6, spread: 1.5, adsSpread: 0.45, perShot: 0.35, maxSpread: 3.6, recoilP: 1.15, recoilY: 0.45, speed: 140, pellets: 1, energy: false, heat: 0, cool: 0, bolt: [[0.6, 1.4, 5], [5, 0.4, 0.2]], boltLen: 3.2, boltThick: 1.5, zoom: 1.6, scope: false, moveMul: 0.93, muzzle: 0.8, aiRange: 80, muzzlePos: [0, 0.03, -0.8], kick: 0.05 },
  lr50: { id: "lr50", name: "LR-50 LONGSHOT", kind: "SNIPER RIFLE", auto: false, rpm: 52, dmg: 105, head: 3, falloff: [150, 400, 1], mag: 5, reserve: 30, reload: 3.1, spread: 4.5, adsSpread: 0.02, perShot: 0, maxSpread: 4.5, recoilP: 3.2, recoilY: 0.5, speed: 520, pellets: 1, energy: false, heat: 0, cool: 0, bolt: [[0.7, 1.8, 6], [6, 0.5, 0.2]], boltLen: 6, boltThick: 1.2, zoom: 4, scope: true, moveMul: 0.9, muzzle: 1.1, aiRange: 130, muzzlePos: [0, 0.04, -1.15], kick: 0.08 },
  sg12: { id: "sg12", name: "SG-12 BREACHER", kind: "SHOTGUN", auto: false, rpm: 72, dmg: 13, head: 1.5, falloff: [7, 28, 0.12], mag: 6, reserve: 42, reload: 3.0, spread: 4.2, adsSpread: 3.2, perShot: 0, maxSpread: 4.2, recoilP: 4.2, recoilY: 0.9, speed: 110, pellets: 9, energy: false, heat: 0, cool: 0, bolt: [[0.9, 1.5, 4], [4, 1.2, 0.3]], boltLen: 1.6, boltThick: 0.8, zoom: 1.25, scope: false, moveMul: 0.97, muzzle: 1, aiRange: 22, muzzlePos: [0, 0.03, -0.78], kick: 0.09 },
  pac: { id: "pac", name: "PAC-3 ARC CANNON", kind: "ENERGY WEAPON", auto: true, rpm: 780, dmg: 17, head: 1.5, falloff: [35, 85, 0.55], mag: 0, reserve: 0, reload: 0, spread: 1.4, adsSpread: 0.6, perShot: 0.12, maxSpread: 2.6, recoilP: 0.3, recoilY: 0.18, speed: 120, pellets: 1, energy: true, heat: 0.021, cool: 0.34, bolt: [[0.2, 3.5, 2.6], [4, 1.8, 0.2]], boltLen: 2, boltThick: 1.4, zoom: 1.4, scope: false, moveMul: 0.95, muzzle: 0.7, aiRange: 60, muzzlePos: [0, 0.03, -0.7], kick: 0.015 },
  mg30: { id: "mg30", name: "MG-30 SUPPRESSOR", kind: "MACHINE GUN", auto: true, rpm: 780, dmg: 18, head: 1.5, falloff: [40, 90, 0.55], mag: 100, reserve: 300, reload: 4.2, spread: 1.7, adsSpread: 0.8, perShot: 0.22, maxSpread: 4.5, recoilP: 0.65, recoilY: 0.42, speed: 150, pellets: 1, energy: false, heat: 0, cool: 0, bolt: [[0.6, 1.2, 4.6], [4.8, 0.5, 0.2]], boltLen: 2.8, boltThick: 1.2, zoom: 1.3, scope: false, moveMul: 0.86, muzzle: 0.75, aiRange: 75, muzzlePos: [0, 0.04, -0.85], kick: 0.04 },
  p4: { id: "p4", name: "P-4 SIDEARM", kind: "PISTOL", auto: false, rpm: 380, dmg: 27, head: 1.8, falloff: [25, 60, 0.55], mag: 14, reserve: 84, reload: 1.4, spread: 0.9, adsSpread: 0.35, perShot: 0.4, maxSpread: 2.2, recoilP: 1.2, recoilY: 0.35, speed: 140, pellets: 1, energy: false, heat: 0, cool: 0, bolt: [[0.6, 1.4, 4.4], [4.4, 0.4, 0.3]], boltLen: 1.6, boltThick: 0.9, zoom: 1.2, scope: false, moveMul: 1, muzzle: 0.4, aiRange: 40, muzzlePos: [0, 0.03, -0.28], kick: 0.04 },
};

export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  hp: number;
  speed: number;
  weapons: WeaponSound[];
  grenades: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: { id: "assault", name: "ASSAULT", desc: "Balanced frontline trooper. AR-7 rifle, HR-9 heavy rifle, sidearm.", hp: 100, speed: 1, weapons: ["ar7", "hr9", "p4"], grenades: 3 },
  heavy: { id: "heavy", name: "HEAVY", desc: "Armoured suppression gunner. MG-30, PAC-3 arc cannon (overheats), sidearm.", hp: 150, speed: 0.88, weapons: ["mg30", "pac", "p4"], grenades: 4 },
  sniper: { id: "sniper", name: "SNIPER", desc: "Long-range precision. LR-50 rifle with 4x scope, sidearm.", hp: 85, speed: 1.05, weapons: ["lr50", "p4"], grenades: 2 },
  breacher: { id: "breacher", name: "BREACHER", desc: "Close quarters. SG-12 shotgun, AR-7 rifle, sidearm.", hp: 120, speed: 0.96, weapons: ["sg12", "ar7", "p4"], grenades: 3 },
};

// ---------------- models ----------------
type Mat = "body" | "dark" | "accent" | "glow" | "lens";
type Part = ["b" | "c" | "s", Mat, number, number, number, number, number, number, number?, number?, number?];
// b: box sx,sy,sz ; c: cylinder along z: r,_,len ; s: sphere r

const B = (m: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0): Part => ["b", m, x, y, z, sx, sy, sz, rx, ry, rz];
const C = (m: Mat, x: number, y: number, z: number, r: number, len: number, rx = 0, ry = 0, rz = 0): Part => ["c", m, x, y, z, r, 0, len, rx, ry, rz];

const MODELS: Record<WeaponSound, Part[]> = {
  ar7: [
    B("body", 0, 0.02, -0.12, 0.062, 0.1, 0.34),
    B("dark", 0, 0.015, -0.36, 0.05, 0.07, 0.16),
    B("accent", 0, 0.065, -0.14, 0.05, 0.02, 0.3),
    C("body", 0, 0.03, -0.55, 0.014, 0.4),
    C("dark", 0, 0.03, -0.72, 0.024, 0.07),
    B("dark", 0, 0.01, 0.2, 0.05, 0.085, 0.24),
    B("body", 0, -0.005, 0.33, 0.055, 0.11, 0.03),
    B("dark", 0, -0.095, 0.04, 0.034, 0.12, 0.05, 0.25),
    B("dark", 0, -0.1, -0.13, 0.042, 0.14, 0.08),
    B("glow", 0.0225, -0.1, -0.13, 0.004, 0.1, 0.05),
    B("glow", -0.0225, -0.1, -0.13, 0.004, 0.1, 0.05),
    C("glow", 0, 0.03, -0.4, 0.008, 0.2),
    B("dark", 0, 0.1, -0.1, 0.03, 0.035, 0.1),
    C("lens", 0, 0.1, -0.15, 0.011, 0.01),
    B("body", 0, -0.04, -0.3, 0.045, 0.04, 0.08),
  ],
  hr9: [
    B("body", 0, 0.02, -0.14, 0.075, 0.12, 0.42),
    B("dark", 0, 0.01, -0.46, 0.065, 0.09, 0.22),
    B("accent", 0, 0.085, -0.1, 0.06, 0.02, 0.34),
    C("body", 0, 0.03, -0.66, 0.02, 0.4),
    C("dark", 0, 0.03, -0.8, 0.035, 0.1),
    B("dark", 0, 0.0, 0.24, 0.06, 0.1, 0.3),
    B("body", 0, 0.0, 0.4, 0.065, 0.13, 0.04),
    B("dark", 0, -0.105, 0.05, 0.038, 0.13, 0.055, 0.25),
    B("dark", 0, -0.115, -0.16, 0.06, 0.15, 0.12),
    B("glow", 0.031, -0.115, -0.16, 0.004, 0.11, 0.09),
    B("glow", -0.031, -0.115, -0.16, 0.004, 0.11, 0.09),
    B("body", 0, 0.115, -0.2, 0.05, 0.04, 0.2),
    C("lens", 0, 0.12, -0.31, 0.018, 0.01),
    C("glow", 0, 0.03, -0.5, 0.012, 0.22),
    B("dark", 0, -0.065, -0.5, 0.035, 0.09, 0.05),
  ],
  lr50: [
    B("body", 0, 0.02, -0.1, 0.055, 0.1, 0.36),
    C("body", 0, 0.035, -0.62, 0.014, 0.8),
    C("dark", 0, 0.035, -1.1, 0.026, 0.14),
    B("dark", 0, 0.0, 0.22, 0.05, 0.1, 0.3),
    B("accent", 0, 0.052, 0.22, 0.04, 0.012, 0.22),
    B("dark", 0, -0.095, 0.03, 0.032, 0.12, 0.05, 0.25),
    B("dark", 0, -0.08, -0.1, 0.04, 0.1, 0.07),
    C("dark", 0, 0.115, -0.1, 0.034, 0.34),
    C("body", 0, 0.115, 0.1, 0.04, 0.07),
    C("body", 0, 0.115, -0.28, 0.042, 0.06),
    C("lens", 0, 0.115, 0.14, 0.032, 0.005),
    B("dark", 0, 0.08, -0.1, 0.03, 0.04, 0.08),
    B("body", 0.02, -0.02, -0.55, 0.01, 0.1, 0.01, 0, 0, 0.5),
    B("body", -0.02, -0.02, -0.55, 0.01, 0.1, 0.01, 0, 0, -0.5),
    C("glow", 0, 0.035, -0.7, 0.007, 0.4),
  ],
  sg12: [
    B("body", 0, 0.02, -0.08, 0.07, 0.11, 0.38),
    C("body", 0, 0.045, -0.58, 0.026, 0.55),
    C("dark", 0, -0.005, -0.5, 0.032, 0.34),
    C("body", 0, 0.045, -0.82, 0.032, 0.05),
    B("dark", 0, -0.01, -0.42, 0.06, 0.06, 0.2),
    B("dark", 0, 0.0, 0.22, 0.055, 0.1, 0.28),
    B("body", 0, -0.005, 0.37, 0.06, 0.12, 0.03),
    B("dark", 0, -0.1, 0.05, 0.036, 0.12, 0.05, 0.25),
    B("accent", 0, 0.08, -0.08, 0.04, 0.02, 0.3),
    B("glow", 0.036, 0.02, -0.12, 0.004, 0.05, 0.14),
    B("glow", -0.036, 0.02, -0.12, 0.004, 0.05, 0.14),
    B("dark", 0, -0.06, -0.22, 0.045, 0.05, 0.1),
    C("lens", 0, 0.085, -0.75, 0.007, 0.012),
  ],
  pac: [
    B("body", 0, 0.015, -0.1, 0.09, 0.13, 0.38),
    C("body", 0, 0.02, -0.46, 0.04, 0.25),
    C("dark", 0, 0.02, -0.62, 0.05, 0.12),
    C("glow", 0, 0.02, -0.5, 0.044, 0.14),
    B("dark", 0, 0.0, 0.2, 0.07, 0.11, 0.24),
    B("accent", 0, 0.085, -0.1, 0.07, 0.02, 0.3),
    B("dark", 0, -0.1, 0.05, 0.04, 0.12, 0.055, 0.25),
    B("dark", 0, -0.11, -0.2, 0.05, 0.14, 0.1),
    B("glow", 0, 0.015, -0.1, 0.092, 0.03, 0.06),
    C("glow", 0.065, 0.015, -0.1, 0.012, 0.3),
    C("glow", -0.065, 0.015, -0.1, 0.012, 0.3),
    B("body", 0.05, 0.12, -0.28, 0.02, 0.05, 0.2),
    B("body", -0.05, 0.12, -0.28, 0.02, 0.05, 0.2),
    B("dark", 0, 0.1, -0.5, 0.05, 0.05, 0.05),
    C("dark", 0, 0.02, -0.7, 0.056, 0.03),
  ],
  mg30: [
    B("body", 0, 0.025, -0.1, 0.08, 0.13, 0.5),
    C("body", 0, 0.045, -0.62, 0.02, 0.55),
    C("dark", 0, 0.045, -0.5, 0.034, 0.25),
    C("dark", 0, 0.045, -0.88, 0.032, 0.1),
    B("dark", 0, 0.01, 0.28, 0.06, 0.1, 0.28),
    B("body", 0, 0.0, 0.43, 0.065, 0.13, 0.03),
    B("dark", 0, -0.105, 0.08, 0.038, 0.13, 0.055, 0.25),
    B("dark", 0, -0.12, -0.2, 0.09, 0.15, 0.15),
    B("glow", 0.046, -0.12, -0.2, 0.004, 0.11, 0.1),
    B("glow", -0.046, -0.12, -0.2, 0.004, 0.11, 0.1),
    B("accent", 0, 0.1, -0.12, 0.06, 0.03, 0.4),
    B("body", 0, 0.14, -0.3, 0.012, 0.06, 0.012),
    B("body", 0.05, -0.05, -0.62, 0.012, 0.16, 0.012, 0, 0, 0.45),
    B("body", -0.05, -0.05, -0.62, 0.012, 0.16, 0.012, 0, 0, -0.45),
    B("body", 0.05, 0.12, 0.0, 0.01, 0.03, 0.05),
  ],
  p4: [
    B("body", 0, 0.02, -0.08, 0.04, 0.06, 0.24),
    B("dark", 0, -0.04, 0.03, 0.034, 0.1, 0.05, 0.2),
    C("body", 0, 0.025, -0.24, 0.012, 0.12),
    C("dark", 0, 0.025, -0.3, 0.017, 0.04),
    B("accent", 0, 0.052, -0.08, 0.025, 0.014, 0.18),
    B("glow", 0.0205, 0.018, -0.1, 0.004, 0.025, 0.12),
    B("glow", -0.0205, 0.018, -0.1, 0.004, 0.025, 0.12),
    B("dark", 0, 0.06, 0.0, 0.02, 0.02, 0.03),
    B("dark", 0, -0.01, -0.04, 0.03, 0.04, 0.04),
  ],
};

let mats: Record<Mat, THREE.Material> | null = null;
const cache = new Map<string, THREE.Group>();

export function initWeaponMaterials(tex: number) {
  if (mats) return;
  const p = getPBR("darkMetal", tex);
  const body = new THREE.MeshStandardMaterial({ map: p.map, normalMap: p.normalMap, roughnessMap: p.orm, metalnessMap: p.orm, roughness: 1, metalness: 1, color: new THREE.Color(0.8, 0.82, 0.86), envMapIntensity: 1.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.55, metalness: 0.35, normalMap: p.normalMap, envMapIntensity: 1 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 0.35, metalness: 0.8, envMapIntensity: 1.2 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 3), toneMapped: false });
  const lens = new THREE.MeshStandardMaterial({ color: 0x050a10, roughness: 0.05, metalness: 1, emissive: new THREE.Color(0.0, 0.3, 0.5), envMapIntensity: 2 });
  mats = { body, dark, accent, glow, lens };
}

export function weaponTeamColors(team: number) {
  return team === 0 ? { glow: new THREE.Color(0.4, 1.5, 3.2), accent: new THREE.Color(0.55, 0.65, 0.8) } : { glow: new THREE.Color(3.2, 0.5, 0.25), accent: new THREE.Color(0.35, 0.3, 0.3) };
}

/** Build weapon model (merged geometry per material). Barrel along -Z. Cached geometry per weapon+team. */
export function buildWeaponModel(id: WeaponSound, team: number): THREE.Group {
  const k = id + team;
  const c = cache.get(k);
  if (c) return c.clone();
  if (!mats) initWeaponMaterials(256);
  const tc = weaponTeamColors(team);
  const teamMats: Record<Mat, THREE.Material> = {
    ...mats!,
    glow: new THREE.MeshBasicMaterial({ color: tc.glow, toneMapped: false }),
    accent: new THREE.MeshStandardMaterial({ color: tc.accent, roughness: 0.35, metalness: 0.7, envMapIntensity: 1.2 }),
  };
  const buckets: Record<Mat, THREE.BufferGeometry[]> = { body: [], dark: [], accent: [], glow: [], lens: [] };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const part of MODELS[id]) {
    const [kind, mat, x, y, z, a, b, cc, rx = 0, ry = 0, rz = 0] = part;
    let g: THREE.BufferGeometry;
    if (kind === "b") g = new THREE.BoxGeometry(a, b, cc);
    else if (kind === "c") {
      g = new THREE.CylinderGeometry(a, a, cc, 12, 1);
      g.rotateX(Math.PI / 2);
    } else g = new THREE.SphereGeometry(a, 10, 8);
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    m.compose(p.set(x, y, z), q, s);
    g.applyMatrix4(m);
    buckets[mat].push(g);
  }
  const grp = new THREE.Group();
  for (const key of Object.keys(buckets) as Mat[]) {
    if (!buckets[key].length) continue;
    const g = mergeGeometries(buckets[key], false)!;
    const mesh = new THREE.Mesh(g, teamMats[key]);
    mesh.castShadow = key !== "glow";
    grp.add(mesh);
  }
  cache.set(k, grp);
  return grp.clone();
}
