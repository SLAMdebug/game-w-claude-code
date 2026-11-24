import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ClassId } from "./types";
import type { WeaponSound } from "./audio";
import { buildWeaponModel, WEAPONS } from "./weapons";
import { getPBR } from "./textures";

const CLASS_COLOR: Record<ClassId, [number, number, number]> = {
  assault: [0.05, 0.25, 1.0],
  heavy: [1.0, 0.28, 0.02],
  sniper: [0.1, 0.8, 0.12],
  breacher: [1.0, 0.75, 0.02],
};

class PB {
  geos: THREE.BufferGeometry[] = [];
  m = new THREE.Matrix4();
  q = new THREE.Quaternion();
  e = new THREE.Euler();
  p = new THREE.Vector3();
  s = new THREE.Vector3(1, 1, 1);
  constructor(public vary = 0.06) {}
  private finish(g: THREE.BufferGeometry, col: [number, number, number], x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    g.applyMatrix4(this.m);
    const n = g.getAttribute("position").count;
    const c = new Float32Array(n * 3);
    const v = 1 + (Math.random() - 0.5) * this.vary;
    for (let i = 0; i < n; i++) {
      c[i * 3] = col[0] * v;
      c[i * 3 + 1] = col[1] * v;
      c[i * 3 + 2] = col[2] * v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    if (g.index === null) throw new Error("non-indexed");
    this.geos.push(g);
  }
  box(col: [number, number, number], x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) {
    this.finish(new THREE.BoxGeometry(w, h, d), col, x, y, z, rx, ry, rz);
  }
  cyl(col: [number, number, number], x: number, y: number, z: number, rt: number, rb: number, h: number, seg = 10, rx = 0, ry = 0, rz = 0, sx = 1, sz = 1) {
    this.finish(new THREE.CylinderGeometry(rt, rb, h, seg), col, x, y, z, rx, ry, rz, sx, 1, sz);
  }
  sph(col: [number, number, number], x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, half = false) {
    const g = half ? new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.SphereGeometry(r, 16, 12);
    this.finish(g, col, x, y, z, rx, ry, rz, sx, sy, sz);
  }
  build() {
    const g = mergeGeometries(this.geos, false)!;
    g.computeBoundingSphere();
    return g;
  }
}

interface SoldierGeos {
  head: THREE.BufferGeometry; visor: THREE.BufferGeometry; torso: THREE.BufferGeometry; pelvis: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry; foreArm: THREE.BufferGeometry; thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry;
  scale: number; width: number;
}

const geoCache = new Map<string, SoldierGeos>();

function buildGeos(team: number, cls: ClassId): SoldierGeos {
  const k = team + cls;
  const hit = geoCache.get(k);
  if (hit) return hit;
  const armor: [number, number, number] = team === 0 ? [0.72, 0.76, 0.82] : [0.075, 0.075, 0.085];
  const armor2: [number, number, number] = team === 0 ? [0.5, 0.54, 0.6] : [0.14, 0.13, 0.14];
  const accent: [number, number, number] = team === 0 ? [0.03, 0.2, 0.55] : [0.5, 0.04, 0.03];
  const suit: [number, number, number] = team === 0 ? [0.045, 0.05, 0.06] : [0.04, 0.035, 0.035];
  const metal: [number, number, number] = [0.12, 0.13, 0.15];
  const cc = CLASS_COLOR[cls];
  const heavy = cls === "heavy";
  const sniper = cls === "sniper";
  const breacher = cls === "breacher";
  const wMul = heavy ? 1.2 : sniper ? 0.93 : 1.04;

  // ---- torso
  let b = new PB();
  b.box(suit, 0, 0.2, 0, 0.3 * wMul, 0.36, 0.2);
  b.box(armor, 0, 0.4, -0.01, 0.37 * wMul, 0.25, 0.25);
  b.box(armor2, 0, 0.44, -0.14, 0.3 * wMul, 0.15, 0.05, 0.25, 0, 0);
  b.box(accent, 0, 0.36, -0.139, 0.05, 0.2, 0.012);
  b.box(cc, -0.12 * wMul, 0.43, -0.147, 0.03, 0.08, 0.01);
  for (let i = 0; i < 3; i++) b.box(i % 2 ? armor2 : armor, 0, 0.12 - i * 0.06, -0.015, (0.27 - i * 0.015) * wMul, 0.055, 0.18 + (i === 0 ? 0.015 : 0));
  b.box(metal, 0, 0.0, 0, 0.35 * wMul, 0.07, 0.22);
  b.box(metal, 0, 0.0, -0.115, 0.06, 0.07, 0.02);
  b.box(armor2, 0.14 * wMul, -0.01, -0.12, 0.07, 0.08, 0.05);
  b.box(armor2, -0.14 * wMul, -0.01, -0.12, 0.07, 0.08, 0.05);
  b.box(metal, 0, 0.5, 0.0, 0.46 * wMul, 0.07, 0.2);
  b.cyl(suit, 0, 0.57, 0, 0.075, 0.095, 0.07, 10);
  b.box(armor2, 0, 0.42, 0.14, 0.3 * wMul, 0.28, 0.1);
  b.box(metal, 0.08, 0.5, 0.215, 0.06, 0.05, 0.05);
  b.box(metal, -0.08, 0.5, 0.215, 0.06, 0.05, 0.05);
  b.box(accent, 0, 0.3, 0.195, 0.05, 0.2, 0.01);
  if (heavy) {
    b.box(metal, 0, 0.32, 0.22, 0.32, 0.34, 0.14);
    b.cyl(armor2, 0.1, 0.36, 0.3, 0.05, 0.05, 0.3, 8, Math.PI / 2, 0, 0);
    b.cyl(armor2, -0.1, 0.36, 0.3, 0.05, 0.05, 0.3, 8, Math.PI / 2, 0, 0);
    b.box(armor, 0, 0.38, -0.15, 0.4, 0.27, 0.06);
    for (let i = 0; i < 6; i++) b.cyl([0.5, 0.35, 0.05], -0.15 + i * 0.06, 0.18, -0.13, 0.015, 0.015, 0.09, 6);
  }
  if (sniper) {
    b.box(suit, 0, 0.14, 0.2, 0.3, 0.7, 0.025, -0.12, 0, 0);
    b.box(team === 0 ? [0.12, 0.16, 0.12] : [0.08, 0.05, 0.05], 0, 0.52, 0.14, 0.42, 0.1, 0.18, 0.2, 0, 0);
    b.cyl(metal, 0.16, 0.28, 0.17, 0.02, 0.02, 0.4, 8, 0.1, 0, 0);
  }
  if (breacher) {
    b.box(armor2, 0, 0.22, -0.145, 0.34, 0.2, 0.04);
    for (let i = 0; i < 4; i++) b.cyl([0.6, 0.45, 0.1], -0.12 + i * 0.08, 0.16, -0.17, 0.02, 0.02, 0.09, 6);
    b.box(cc, 0, 0.2, -0.17, 0.3, 0.015, 0.01);
  }
  const torso = b.build();

  // ---- pelvis
  b = new PB();
  b.box(suit, 0, 0, 0, 0.33 * wMul, 0.14, 0.2);
  b.box(armor, 0, -0.03, -0.11, 0.13, 0.16, 0.03, 0.1, 0, 0);
  b.box(armor2, 0.175 * wMul, -0.02, 0, 0.07, 0.13, 0.15);
  b.box(armor2, -0.175 * wMul, -0.02, 0, 0.07, 0.13, 0.15);
  b.box(armor, 0, -0.03, 0.11, 0.15, 0.13, 0.03);
  const pelvis = b.build();

  // ---- head
  b = new PB(0.03);
  let vis: THREE.BufferGeometry;
  if (team === 0) {
    b.sph(armor, 0, 0.13, 0.005, 0.128, 1, 1.08, 1.14);
    b.box(armor2, 0, 0.255, 0, 0.035, 0.03, 0.22);
    b.box(armor2, 0.125, 0.1, -0.02, 0.03, 0.09, 0.09);
    b.box(armor2, -0.125, 0.1, -0.02, 0.03, 0.09, 0.09);
    b.box(metal, 0, 0.03, -0.1, 0.1, 0.07, 0.06);
    b.cyl(metal, 0.03, 0.03, -0.12, 0.012, 0.012, 0.04, 6, Math.PI / 2);
    b.cyl(metal, -0.03, 0.03, -0.12, 0.012, 0.012, 0.04, 6, Math.PI / 2);
    b.box(accent, 0, 0.215, -0.02, 0.05, 0.012, 0.17);
    b.cyl(metal, 0.14, 0.2, 0.05, 0.005, 0.005, 0.18, 4);
    b.cyl(suit, 0, -0.01, 0, 0.06, 0.07, 0.08, 8);
    if (sniper) b.cyl(metal, -0.12, 0.15, -0.09, 0.025, 0.025, 0.12, 8, Math.PI / 2);
    if (heavy) b.box(armor2, 0, 0.21, -0.1, 0.2, 0.05, 0.05);
    const v = new PB(0);
    v.sph([0.01, 0.015, 0.02], 0, 0.14, -0.082, 0.08, 1.4, 0.7, 0.5);
    vis = v.build();
  } else {
    b.cyl(armor, 0, 0.13, 0.005, 0.12, 0.14, 0.26, 7, 0, 0.3, 0, 1, 1.12);
    b.box(armor2, 0, 0.27, 0.02, 0.03, 0.06, 0.26);
    b.box(armor2, 0.13, 0.1, 0, 0.03, 0.12, 0.12);
    b.box(armor2, -0.13, 0.1, 0, 0.03, 0.12, 0.12);
    b.box(armor, 0, 0.19, -0.115, 0.2, 0.07, 0.06, 0.4, 0, 0);
    b.cyl(metal, 0, 0.02, -0.11, 0.055, 0.04, 0.13, 8, Math.PI / 2);
    b.box(accent, 0.1, 0.13, -0.12, 0.005, 0.1, 0.04);
    b.box(accent, -0.1, 0.13, -0.12, 0.005, 0.1, 0.04);
    b.cyl(suit, 0, -0.01, 0, 0.06, 0.07, 0.08, 8);
    b.box(accent, 0, 0.3, 0.1, 0.02, 0.09, 0.14, 0.4, 0, 0);
    if (sniper) b.cyl(metal, -0.14, 0.15, -0.07, 0.025, 0.025, 0.12, 8, Math.PI / 2);
    if (heavy) b.box(armor2, 0, 0.0, -0.13, 0.2, 0.1, 0.05);
    const v = new PB(0);
    v.box([0.02, 0.0, 0.0], 0, 0.14, -0.123, 0.19, 0.03, 0.04, 0.1, 0, 0);
    vis = v.build();
  }
  const head = b.build();

  // ---- arms
  b = new PB();
  b.cyl(suit, 0, -0.145, 0, 0.048, 0.042, 0.3, 8);
  b.sph(armor, 0, 0.0, 0, heavy ? 0.135 : 0.1, 1.1, 0.8, 1.15, 0, 0, 0, true);
  b.box(cc, 0, 0.0, -0.1, heavy ? 0.1 : 0.07, 0.02, 0.012, 0.35, 0, 0);
  b.box(armor, 0, -0.12, 0, 0.09, 0.15, 0.095);
  if (heavy) b.box(armor2, 0, -0.02, 0, 0.17, 0.04, 0.17);
  const upperArm = b.build();

  b = new PB();
  b.cyl(suit, 0, -0.14, 0, 0.042, 0.036, 0.29, 8);
  b.box(armor, 0, -0.12, -0.005, 0.082, 0.16, 0.085);
  b.box(metal, 0, -0.22, 0, 0.07, 0.03, 0.07);
  b.box([0.03, 0.03, 0.035], 0, -0.28, 0, 0.068, 0.09, 0.055);
  b.box([0.03, 0.03, 0.035], 0, -0.335, -0.012, 0.06, 0.04, 0.05);
  if (breacher) b.box(armor2, 0.05, -0.11, 0, 0.02, 0.2, 0.12);
  const foreArm = b.build();

  // ---- legs
  b = new PB();
  b.cyl(suit, 0, -0.225, 0, 0.078, 0.062, 0.46, 8);
  b.box(armor, 0, -0.19, -0.015, 0.13, 0.26, 0.15);
  b.box(armor2, 0.075, -0.2, 0, 0.03, 0.2, 0.1);
  if (heavy) b.box(armor2, 0.09, -0.15, 0, 0.05, 0.12, 0.12);
  b.box(metal, 0, -0.05, -0.08, 0.1, 0.05, 0.04);
  const thigh = b.build();

  b = new PB();
  b.cyl(suit, 0, -0.225, 0, 0.058, 0.048, 0.46, 8);
  b.box(armor, 0, 0.0, -0.065, 0.11, 0.11, 0.07, -0.2, 0, 0);
  b.box(armor, 0, -0.2, -0.045, 0.1, 0.28, 0.07, 0.04, 0, 0);
  b.box(armor2, 0, -0.24, 0.05, 0.08, 0.2, 0.05);
  b.box([0.03, 0.03, 0.03], 0, -0.43, -0.04, 0.105, 0.1, 0.27);
  b.box(metal, 0, -0.45, -0.17, 0.095, 0.06, 0.08);
  b.box(armor2, 0, -0.4, -0.09, 0.1, 0.04, 0.12, -0.3, 0, 0);
  const shin = b.build();

  const out: SoldierGeos = { head, visor: vis, torso, pelvis, upperArm, foreArm, thigh, shin, scale: heavy ? 1.07 : sniper ? 1.0 : 0.98, width: wMul };
  geoCache.set(k, out);
  return out;
}

const matCache = new Map<string, { armor: THREE.MeshStandardMaterial; visor: THREE.MeshStandardMaterial }>();
export function soldierMaterials(team: number, tex: number) {
  const k = team + "_" + tex;
  const c = matCache.get(k);
  if (c) return c;
  const p = getPBR(team === 0 ? "armorBlue" : "armorRed", tex);
  const armor = new THREE.MeshStandardMaterial({ map: p.map, normalMap: p.normalMap, roughnessMap: p.orm, metalnessMap: p.orm, roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 1.1 });
  armor.normalScale.set(0.8, 0.8);
  const visor = new THREE.MeshStandardMaterial({ color: 0x050709, roughness: 0.04, metalness: 1, emissive: team === 0 ? new THREE.Color(0.1, 0.9, 1.6) : new THREE.Color(2.6, 0.12, 0.05), envMapIntensity: 2.5 });
  visor.emissiveIntensity = team === 0 ? 0.55 : 1;
  const out = { armor, visor };
  matCache.set(k, out);
  return out;
}

// ---------- IK ----------
const DOWN = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3(), _dir = new THREE.Vector3(), _pp = new THREE.Vector3(), _E = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
const _qi = new THREE.Quaternion();
export function ik(sh: THREE.Object3D, el: THREE.Object3D, S: THREE.Vector3, T: THREE.Vector3, pole: THREE.Vector3, L1: number, L2: number) {
  _d.copy(T).sub(S);
  let dist = _d.length();
  const maxd = L1 + L2 - 0.003;
  if (dist > maxd) { _d.multiplyScalar(maxd / dist); dist = maxd; }
  if (dist < 0.12) { dist = 0.12; }
  _dir.copy(_d).normalize();
  const a = (dist * dist + L1 * L1 - L2 * L2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _pp.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_pp.lengthSq() < 1e-6) _pp.set(0, -1, 0);
  _pp.normalize();
  _E.copy(S).addScaledVector(_dir, a).addScaledVector(_pp, h);
  _u.copy(_E).sub(S).normalize();
  _f.copy(S).add(_d).sub(_E).normalize();
  sh.quaternion.setFromUnitVectors(DOWN, _u);
  _qi.copy(sh.quaternion).invert();
  _f.applyQuaternion(_qi);
  el.quaternion.setFromUnitVectors(DOWN, _f);
}

const GRIP: Record<WeaponSound, { l: [number, number, number]; r: [number, number, number] }> = {
  ar7: { l: [0, -0.035, -0.31], r: [0, -0.1, 0.04] },
  hr9: { l: [0, -0.05, -0.4], r: [0, -0.11, 0.05] },
  lr50: { l: [0, -0.04, -0.45], r: [0, -0.1, 0.03] },
  sg12: { l: [0, -0.05, -0.46], r: [0, -0.1, 0.05] },
  pac: { l: [0, -0.05, -0.4], r: [0, -0.1, 0.05] },
  mg30: { l: [0, -0.05, -0.42], r: [0, -0.11, 0.08] },
  p4: { l: [0.0, -0.05, -0.02], r: [0, -0.05, 0.03] },
};
export const gripOf = (w: WeaponSound) => GRIP[w];

export interface AnimState {
  speed: number;
  sprint: boolean;
  crouch: boolean;
  aim: number; // 0 low ready .. 1 raised
  pitch: number;
  reload: number; // -1 none, 0..1
  grounded: boolean;
  vy: number;
  hurt: number;
  fire: number;
  alive: boolean;
  deadT: number;
  deathType: number;
  strafe: number;
}

const S_R = new THREE.Vector3(0.215, 0.5, 0);
const S_L = new THREE.Vector3(-0.215, 0.5, 0);
const POLE_R = new THREE.Vector3(0.7, -0.8, 0.5).normalize();
const POLE_L = new THREE.Vector3(-0.7, -0.8, 0.5).normalize();

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _gq = new THREE.Quaternion(), _ge = new THREE.Euler();

export class SoldierModel {
  root = new THREE.Group();
  body = new THREE.Group(); // scaled
  hips = new THREE.Group();
  torso = new THREE.Group();
  headG = new THREE.Group();
  shR = new THREE.Group(); elR = new THREE.Group();
  shL = new THREE.Group(); elL = new THREE.Group();
  thR = new THREE.Group(); knR = new THREE.Group();
  thL = new THREE.Group(); knL = new THREE.Group();
  gun = new THREE.Group();
  gunModel: THREE.Group | null = null;
  meshes: THREE.Mesh[] = [];
  visorMesh: THREE.Mesh;
  phase = Math.random() * 6;
  crouchB = 0;
  aimB = 0;
  sprintB = 0;
  air = 0;
  hurtV = 0;
  kick = 0;
  stepCount = 0;
  weaponId: WeaponSound = "ar7";
  lod = 0;
  team: number;
  muzzle = new THREE.Object3D();
  deadBlend = 0;
  constructor(public cls: ClassId, team: number, tex: number) {
    this.team = team;
    const g = buildGeos(team, cls);
    const m = soldierMaterials(team, tex);
    const mk = (geo: THREE.BufferGeometry, parent: THREE.Object3D, mat: THREE.Material = m.armor) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    this.root.add(this.body);
    this.body.scale.setScalar(g.scale);
    this.body.add(this.hips);
    this.hips.position.set(0, 0.97, 0);
    mk(g.pelvis, this.hips);
    this.hips.add(this.torso);
    this.torso.position.set(0, 0.06, 0);
    mk(g.torso, this.torso);
    this.torso.add(this.headG);
    this.headG.position.set(0, 0.6, 0);
    mk(g.head, this.headG);
    this.visorMesh = mk(g.visor, this.headG, m.visor);
    this.visorMesh.castShadow = false;
    const arm = (sh: THREE.Group, el: THREE.Group, s: THREE.Vector3) => {
      this.torso.add(sh);
      sh.position.copy(s);
      mk(g.upperArm, sh);
      sh.add(el);
      el.position.set(0, -0.29, 0);
      mk(g.foreArm, el);
    };
    arm(this.shR, this.elR, S_R);
    arm(this.shL, this.elL, S_L);
    const leg = (th: THREE.Group, kn: THREE.Group, x: number) => {
      this.hips.add(th);
      th.position.set(x, -0.04, 0);
      mk(g.thigh, th);
      th.add(kn);
      kn.position.set(0, -0.46, 0);
      mk(g.shin, kn);
    };
    leg(this.thR, this.knR, 0.1);
    leg(this.thL, this.knL, -0.1);
    this.torso.add(this.gun);
    this.setWeapon("ar7");
  }

  setWeapon(id: WeaponSound) {
    if (this.gunModel) this.gun.remove(this.gunModel);
    this.weaponId = id;
    this.gunModel = buildWeaponModel(id, this.team);
    this.gunModel.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.lod === 0; });
    this.gun.add(this.gunModel);
    const mp = WEAPONS[id].muzzlePos;
    this.muzzle.position.set(mp[0], mp[1], mp[2]);
    this.gun.add(this.muzzle);
  }

  setLOD(l: number) {
    if (l === this.lod) return;
    this.lod = l;
    const near = l === 0;
    for (const m of this.meshes) m.castShadow = near;
    this.visorMesh.visible = l < 2;
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.visorMesh) (o as THREE.Mesh).castShadow = near; });
  }

  /** returns number of footsteps this frame */
  update(dt: number, s: AnimState) {
    const k = Math.min(1, dt * 12);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    this.crouchB = lerp(this.crouchB, s.crouch ? 1 : 0, Math.min(1, dt * 9));
    this.aimB = lerp(this.aimB, s.sprint ? 0 : s.aim, k);
    this.sprintB = lerp(this.sprintB, s.sprint && s.speed > 3 ? 1 : 0, k);
    this.air = lerp(this.air, s.grounded ? 0 : 1, Math.min(1, dt * 10));
    this.hurtV = Math.max(0, this.hurtV - dt * 3.5);
    if (s.hurt > 0) this.hurtV = Math.max(this.hurtV, s.hurt);
    this.kick = Math.max(this.kick, s.fire);
    this.kick = Math.max(0, this.kick - dt * 9);
    const prevStep = Math.floor(this.phase / Math.PI);
    const moving = s.speed > 0.4 && s.grounded;
    if (moving) this.phase += dt * Math.PI * 2 * (0.75 + s.speed * 0.13) * (this.crouchB > 0.5 ? 0.8 : 1);
    this.stepCount = moving ? Math.floor(this.phase / Math.PI) - prevStep : 0;
    const t = performance.now() / 1000;

    if (!s.alive) return this.updateDeath(dt, s);
    this.root.rotation.x = 0;
    this.root.position.y = 0;
    this.body.rotation.set(0, 0, 0);

    const spN = Math.min(1, s.speed / 6.2);
    const amp = Math.min(0.95, 0.16 + spN * 0.85) * (moving ? 1 : 0);
    const ph = this.phase;
    const sn = Math.sin(ph), cs = Math.cos(ph);
    const cr = this.crouchB;
    const cA = 0.95 * cr;
    // legs
    let thR = sn * amp * 0.85;
    let thL = -sn * amp * 0.85;
    let knR = -Math.max(0, cs) * amp * 1.25 - 0.06 * amp;
    let knL = -Math.max(0, -cs) * amp * 1.25 - 0.06 * amp;
    thR += cA + this.air * 0.5; thL += cA * 0.85 - this.air * 0.15;
    knR += -cA * 2 - this.air * 1.0; knL += -cA * 1.9 - this.air * 0.4;
    this.thR.rotation.set(thR, 0, -0.03 * amp); this.thL.rotation.set(thL, 0, 0.03 * amp);
    this.knR.rotation.set(knR, 0, 0); this.knL.rotation.set(knL, 0, 0);
    // hips height
    const bob = moving ? Math.abs(Math.cos(ph)) * 0.035 * amp : Math.sin(t * 1.6) * 0.004;
    this.hips.position.y = 0.97 - 2 * 0.46 * (1 - Math.cos(cA)) * 0.97 + bob - this.air * 0.04;
    this.hips.rotation.y = moving ? sn * 0.12 * amp : 0;
    this.hips.position.x = 0;
    // torso
    const lean = this.sprintB * 0.28 + (moving ? amp * 0.05 : 0);
    const pitchTorso = THREE.MathUtils.clamp(s.pitch, -1.2, 1.2) * 0.62;
    this.torso.rotation.set(-lean + pitchTorso - this.hurtV * 0.4 - this.kick * 0.03, -this.hips.rotation.y * 0.8 + this.aimB * 0.25 * 0 + this.hurtV * 0.3, this.hurtV * 0.2 + s.strafe * -0.04);
    this.headG.rotation.set(THREE.MathUtils.clamp(s.pitch, -1.2, 1.2) * 0.38 + lean * 0.9 - this.hurtV * 0.2, 0, 0);
    // gun
    const aim = this.aimB;
    const rl = s.reload;
    // pose: low ready vs aim
    const gx = lerp(0.1, 0.075, aim), gy = lerp(0.2, 0.46, aim), gz = lerp(-0.27, -0.3, aim);
    const sprintDown = this.sprintB;
    let gpx = gx + sprintDown * 0.05;
    let gpy = gy - sprintDown * 0.22 + (moving ? Math.sin(ph * 2) * 0.01 * amp : Math.sin(t * 1.6) * 0.003);
    let gpz = gz + this.kick * 0.07 + sprintDown * 0.05;
    let grx = lerp(-0.42, 0.0, aim) + this.kick * 0.1 - sprintDown * 0.5;
    let gry = sprintDown * 0.5;
    let grz = sprintDown * -0.15;
    let reloadLeft = 0;
    if (rl >= 0) {
      const e = Math.sin(Math.min(1, rl) * Math.PI);
      gpy -= e * 0.12; gpx += e * 0.03; grx += e * 0.35; grz -= e * 0.5; gry += e * 0.2;
      reloadLeft = rl;
    }
    this.gun.position.set(gpx, gpy, gpz);
    _ge.set(grx, gry, grz);
    this.gun.quaternion.setFromEuler(_ge);
    // hands
    const gr = gripOf(this.weaponId);
    _gq.copy(this.gun.quaternion);
    _t1.set(gr.r[0], gr.r[1], gr.r[2]).applyQuaternion(_gq).add(this.gun.position);
    _t2.set(gr.l[0], gr.l[1], gr.l[2]);
    if (rl >= 0 && this.weaponId !== "pac") {
      // left hand goes to mag, pulls it, and returns
      const mag = new THREE.Vector3(0, -0.13, -0.14);
      const away = new THREE.Vector3(0.0, -0.42, -0.08);
      let tgt: THREE.Vector3;
      const r = reloadLeft;
      if (r < 0.2) tgt = _t2.clone().lerp(mag, r / 0.2);
      else if (r < 0.4) tgt = mag.clone().lerp(away, (r - 0.2) / 0.2);
      else if (r < 0.65) tgt = away.clone().lerp(mag, (r - 0.4) / 0.25);
      else if (r < 0.8) tgt = mag.clone();
      else tgt = mag.clone().lerp(_t2, (r - 0.8) / 0.2);
      _t2.copy(tgt);
    }
    const tl = _t2.applyQuaternion(_gq).add(this.gun.position);
    ik(this.shR, this.elR, S_R, _t1, POLE_R, 0.29, 0.31);
    ik(this.shL, this.elL, S_L, tl, POLE_L, 0.29, 0.31);
    return this.stepCount;
  }

  private updateDeath(_dt: number, s: AnimState) {
    const t = Math.min(1, s.deadT / 0.75);
    const e = 1 - Math.pow(1 - t, 3);
    const type = s.deathType;
    this.deadBlend = e;
    const r = this.root;
    if (type === 0) { r.rotation.x = -e * 1.5; r.position.y = e * 0.14; this.body.rotation.y = 0; }
    else if (type === 1) { r.rotation.x = e * 1.45; r.position.y = e * 0.12; }
    else { r.rotation.z = (type === 2 ? 1 : -1) * e * 1.5; r.rotation.x = -e * 0.4; r.position.y = e * 0.14; }
    const fl = Math.sin(Math.min(1, s.deadT * 1.6) * Math.PI) * 0.6;
    this.hips.position.y = 0.97 - e * 0.15;
    this.thR.rotation.set(0.25 * e + fl * 0.3, 0, 0.18 * e); this.thL.rotation.set(-0.12 * e - fl * 0.2, 0, -0.2 * e);
    this.knR.rotation.set(-0.5 * e, 0, 0); this.knL.rotation.set(-0.15 * e, 0, 0);
    this.torso.rotation.set(0.1 * e, 0.3 * e, 0);
    this.headG.rotation.set(-0.3 * e, 0.2 * e, 0.2 * e);
    const ts = Math.min(1, e);
    this.shR.quaternion.setFromEuler(_ge.set(0.4 * ts + fl, 0, 1.0 * ts));
    this.elR.quaternion.setFromEuler(_ge.set(-0.4, 0, 0));
    this.shL.quaternion.setFromEuler(_ge.set(-0.3 * ts - fl * 0.5, 0, -0.9 * ts));
    this.elL.quaternion.setFromEuler(_ge.set(-0.3, 0, 0));
    this.gun.position.lerp(_t1.set(0.35, 0.1, -0.25), 0.1);
    return 0;
  }

  resetPose() {
    this.root.rotation.set(0, this.root.rotation.y, 0);
    this.root.position.y = 0;
    this.deadBlend = 0;
    this.hurtV = 0;
    this.crouchB = 0;
  }
}

// ------------- first-person view model -------------
function patchVM(mat: THREE.Material) {
  const m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n gl_Position.z = gl_Position.w * (-1.0 + (gl_Position.z / gl_Position.w + 1.0) * 0.004);");
  };
  m.customProgramCacheKey = () => "vm";
  return m;
}

export class ViewModel {
  root = new THREE.Group();
  gun = new THREE.Group();
  model: THREE.Group | null = null;
  armR = new THREE.Group(); elR = new THREE.Group();
  armL = new THREE.Group(); elL = new THREE.Group();
  muzzle = new THREE.Object3D();
  weaponId: WeaponSound = "ar7";
  ads = 0;
  sway = new THREE.Vector2();
  bobT = 0;
  kick = 0;
  kickR = 0;
  switchT = 1;
  reload = -1;
  sprint = 0;
  team: number;
  constructor(team: number, cls: ClassId, tex: number) {
    this.team = team;
    const g = buildGeos(team, cls);
    const m = soldierMaterials(team, tex);
    const am = patchVM(m.armor);
    const mkArm = (sh: THREE.Group, el: THREE.Group) => {
      const a = new THREE.Mesh(g.upperArm, am);
      const f = new THREE.Mesh(g.foreArm, am);
      a.frustumCulled = f.frustumCulled = false;
      sh.add(a);
      sh.add(el);
      el.position.set(0, -0.29, 0);
      el.add(f);
      this.root.add(sh);
    };
    mkArm(this.armR, this.elR);
    mkArm(this.armL, this.elL);
    this.root.add(this.gun);
    this.setWeapon("ar7");
  }
  setWeapon(id: WeaponSound) {
    if (this.model) this.gun.remove(this.model);
    this.weaponId = id;
    this.model = buildWeaponModel(id, this.team);
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = patchVM(mesh.material as THREE.Material);
        mesh.castShadow = false;
        mesh.frustumCulled = false;
      }
    });
    this.gun.add(this.model);
    const mp = WEAPONS[id].muzzlePos;
    this.muzzle.position.set(mp[0], mp[1], mp[2]);
    this.gun.add(this.muzzle);
    this.switchT = 0;
  }
  update(dt: number, o: { ads: number; moveSpeed: number; sprint: boolean; mouseDX: number; mouseDY: number; reload: number; grounded: boolean; crouch: boolean }) {
    const w = WEAPONS[this.weaponId];
    this.ads = o.ads;
    this.sprint += ((o.sprint && o.moveSpeed > 3 ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    this.switchT = Math.min(1, this.switchT + dt * 3.2);
    this.kick = Math.max(0, this.kick - dt * 10);
    this.kickR = Math.max(0, this.kickR - dt * 9);
    this.sway.x += (-o.mouseDX * 0.0016 - this.sway.x) * Math.min(1, dt * 9);
    this.sway.y += (o.mouseDY * 0.0016 - this.sway.y) * Math.min(1, dt * 9);
    const sw = THREE.MathUtils.clamp;
    const swayX = sw(this.sway.x, -0.04, 0.04), swayY = sw(this.sway.y, -0.04, 0.04);
    if (o.moveSpeed > 0.5 && o.grounded) this.bobT += dt * (6 + o.moveSpeed * 0.9);
    const bobAmt = Math.min(1, o.moveSpeed / 6) * (1 - o.ads * 0.85);
    const bx = Math.sin(this.bobT) * 0.012 * bobAmt;
    const by = Math.abs(Math.cos(this.bobT)) * 0.014 * bobAmt;
    const t = performance.now() / 1000;
    const breathe = Math.sin(t * 1.4) * 0.002 * (1 - o.ads * 0.6);
    // hip -> ads position. Sights are ~0.1 above bore line
    const sightY = w.scope ? 0.17 : w.id === "p4" ? 0.075 : w.id === "hr9" ? 0.145 : w.id === "mg30" ? 0.13 : w.id === "sg12" ? 0.1 : w.id === "pac" ? 0.12 : 0.12;
    const hipX = 0.17, hipY = -0.17, hipZ = -0.34;
    const e = o.ads;
    let px = hipX * (1 - e) + swayX + bx;
    let py = hipY * (1 - e) - sightY * e + swayY + by + breathe;
    let pz = hipZ * (1 - e) + -0.26 * e + this.kick * w.kick * 1.4;
    let rx = this.kick * w.kick * 3 + swayY * 0.6;
    let ry = swayX * 0.8 + (1 - e) * 0.05;
    let rz = -swayX * 0.6;
    // sprint pose
    if (this.sprint > 0) {
      const s = this.sprint;
      px += s * 0.06 + Math.sin(this.bobT) * 0.01 * s; py += -s * 0.1; pz += s * 0.02;
      rx += -s * 0.5; ry += s * 0.65; rz += -s * 0.2;
    }
    // switch (dip)
    const sw1 = 1 - this.switchT;
    py -= sw1 * sw1 * 0.35; rx -= sw1 * 0.6;
    // reload
    const rl = o.reload;
    if (rl >= 0) {
      const ee = Math.sin(Math.min(1, rl) * Math.PI);
      py -= ee * 0.07; rx += ee * 0.25; rz -= ee * 0.5; px -= ee * 0.04; ry += ee * 0.3;
    }
    this.gun.position.set(px, py, pz);
    this.gun.quaternion.setFromEuler(_ge.set(rx, ry, rz));
    // arms
    const gr = gripOf(this.weaponId);
    _gq.copy(this.gun.quaternion);
    const SR = new THREE.Vector3(0.27, -0.3, 0.22), SL = new THREE.Vector3(-0.27, -0.3, 0.22);
    const tr = new THREE.Vector3(gr.r[0], gr.r[1], gr.r[2]).applyQuaternion(_gq).add(this.gun.position);
    const lt = new THREE.Vector3(gr.l[0], gr.l[1], gr.l[2]);
    if (rl >= 0 && this.weaponId !== "pac") {
      const mag = new THREE.Vector3(0, -0.13, -0.14);
      const away = new THREE.Vector3(0.0, -0.46, -0.04);
      if (rl < 0.2) lt.lerp(mag, rl / 0.2);
      else if (rl < 0.4) lt.copy(mag).lerp(away, (rl - 0.2) / 0.2);
      else if (rl < 0.65) lt.copy(away).lerp(mag, (rl - 0.4) / 0.25);
      else if (rl < 0.8) lt.copy(mag);
      else lt.copy(mag).lerp(new THREE.Vector3(gr.l[0], gr.l[1], gr.l[2]), (rl - 0.8) / 0.2);
    }
    lt.applyQuaternion(_gq).add(this.gun.position);
    this.armR.position.copy(SR);
    this.armL.position.copy(SL);
    ik(this.armR, this.elR, SR, tr, new THREE.Vector3(0.6, -0.8, 0.3).normalize(), 0.29, 0.31);
    ik(this.armL, this.elL, SL, lt, new THREE.Vector3(-0.6, -0.8, 0.3).normalize(), 0.29, 0.31);
  }
}
