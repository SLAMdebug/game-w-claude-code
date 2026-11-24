import * as THREE from "three";
import type { ClassId } from "./types";
import type { WeaponDef } from "./weapons";
import { WEAPONS, CLASSES } from "./weapons";
import { SoldierModel } from "./soldier";

export interface WState {
  def: WeaponDef;
  ammo: number;
  reserve: number;
  heat: number;
  overheated: boolean;
  reload: number; // -1 none, else elapsed seconds
  cd: number;
  bloom: number;
}

export function makeWState(id: keyof typeof WEAPONS): WState {
  const def = WEAPONS[id];
  return { def, ammo: def.mag, reserve: def.reserve, heat: 0, overheated: false, reload: -1, cd: 0, bloom: 0 };
}

export interface AIState {
  state: "move" | "engage" | "cover" | "hold" | "investigate";
  target: Soldier | null;
  seen: number; // seconds since last saw target
  lastKnown: THREE.Vector3;
  goal: THREE.Vector3;
  point: number;
  thinkT: number;
  perceptT: number;
  burst: number;
  burstCd: number;
  strafe: number;
  strafeT: number;
  cover: THREE.Vector3 | null;
  coverT: number;
  stuckT: number;
  lastPos: THREE.Vector3;
  avoid: number;
  avoidT: number;
  react: number;
  grenadeCd: number;
  holdT: number;
  unstick: number;
  unstickDir: number;
  jumpT: number;
  skill: number;
  alertT: number;
  repathT: number;
  squad: number;
}

export class Soldier {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hp = 100;
  maxHp = 100;
  alive = true;
  respawnT = 0;
  model: SoldierModel;
  weapons: WState[] = [];
  cur = 0;
  grenades = 3;
  crouch = false;
  sprint = false;
  ads = 0;
  grounded = true;
  lastDmgT = -99;
  deathT = 0;
  deathType = 0;
  kills = 0;
  deaths = 0;
  score = 0;
  speedMul = 1;
  hurt = 0;
  fireAnim = 0;
  surface = "sand";
  lastAttacker: Soldier | null = null;
  spotT = 0;
  ai: AIState | null = null;
  switchT = 0;
  animSpeed = 0;
  strafeAmt = 0;
  killedBy = "";
  streak = 0;
  constructor(public id: number, public name: string, public team: number, public cls: ClassId, public isPlayer: boolean, tex: number) {
    this.model = new SoldierModel(cls, team, tex);
    this.setClass(cls);
    if (!isPlayer) {
      this.ai = {
        state: "move", target: null, seen: 99, lastKnown: new THREE.Vector3(), goal: new THREE.Vector3(), point: 0, thinkT: Math.random(), perceptT: Math.random() * 0.3,
        burst: 0, burstCd: 0, strafe: 1, strafeT: 0, cover: null, coverT: 0, stuckT: 0, lastPos: new THREE.Vector3(), avoid: 0, avoidT: 0, react: 0, grenadeCd: 5 + Math.random() * 10,
        holdT: 0, unstick: 0, unstickDir: 1, jumpT: 0, skill: 0.75 + Math.random() * 0.5, alertT: 0, repathT: 0, squad: 0,
      };
    }
  }
  setClass(cls: ClassId) {
    const c = CLASSES[cls];
    this.cls = cls;
    this.maxHp = c.hp;
    this.hp = c.hp;
    this.speedMul = c.speed;
    this.grenades = c.grenades;
    this.weapons = c.weapons.map((w) => makeWState(w));
    this.cur = 0;
    this.model.setWeapon(this.weapons[0].def.id);
  }
  get w() {
    return this.weapons[this.cur];
  }
  get eyeY() {
    return this.pos.y + (this.crouch ? 1.12 : 1.6);
  }
  get height() {
    return this.crouch ? 1.3 : 1.8;
  }
  get headY() {
    return this.pos.y + (this.crouch ? 1.2 : 1.66);
  }
}

export interface Projectile {
  p: THREE.Vector3;
  v: THREE.Vector3;
  owner: Soldier;
  team: number;
  dmg: number;
  def: WeaponDef;
  origin: THREE.Vector3;
  life: number;
  col: [number, number, number];
  tracer: boolean;
}

export interface Grenade {
  p: THREE.Vector3;
  v: THREE.Vector3;
  owner: Soldier;
  fuse: number;
  beep: number;
  mesh: THREE.Mesh;
  rest: boolean;
}
