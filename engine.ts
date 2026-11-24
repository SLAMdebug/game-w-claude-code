import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { audio, type WeaponSound } from "./audio";
import { Fx, Weather } from "./fx";
import { buildMap, type MapData, type MapPointDef } from "./maps";
import { Post, type PostParams } from "./post";
import { Soldier, type Projectile, type Grenade, makeWState } from "./entities";
import { updateAI } from "./ai";
import { ViewModel } from "./soldier";
import { CLASSES, WEAPONS, initWeaponMaterials } from "./weapons";
import { buildFighter, pbrMat } from "./props";
import type { World } from "./world";
import { DEFAULT_SETTINGS, type ClassId, type HudState, type KillFeedItem, type MapId, type MatchConfig, type Settings } from "./types";

export interface GameCallbacks {
  onHud: (h: HudState) => void;
  onLock: (locked: boolean) => void;
}

export interface PointState {
  def: MapPointDef;
  idx: number;
  owner: number;
  cap: number;
  active: boolean;
  assigned: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  flag: THREE.Mesh;
  flagGeo: THREE.PlaneGeometry;
  y: number;
  contested: boolean;
}

interface BarrelState { x: number; y: number; z: number; hp: number; alive: boolean; col: import("./world").Collider; i: number }
interface Pending { t: number; fn: () => void }

const NAMES0 = ["Vance", "Okoye", "Reyes", "Halloran", "Tsukino", "Marek", "Ibarra", "Kessler", "Dunmore", "Sorensen", "Adeyemi", "Lindqvist", "Castellan", "Yoon", "Petrov", "Navarro", "Brandt", "Okafor", "Silva", "Moreau", "Tanaka", "Quill", "Rhodes", "Ashby"];
const NAMES1 = ["VX-114", "KR-209", "DM-337", "ZT-018", "HK-562", "RV-771", "NX-405", "SK-920", "TL-143", "BR-688", "OM-256", "GH-374", "QX-081", "JD-519", "FP-702", "WN-466", "CA-933", "UZ-127", "MK-845", "EL-390", "PT-604", "XR-218", "YS-051", "LB-789"];

const QUALITY = {
  low: { tex: 256, shadow: 1024, shadowRange: 48, samples: 0, pr: 1, fx: 0.5, geo: 0.5 },
  medium: { tex: 512, shadow: 2048, shadowRange: 60, samples: 2, pr: 1.25, fx: 0.8, geo: 0.8 },
  high: { tex: 512, shadow: 2048, shadowRange: 70, samples: 4, pr: 1.5, fx: 1, geo: 1 },
  ultra: { tex: 1024, shadow: 4096, shadowRange: 80, samples: 4, pr: 2, fx: 1.2, geo: 1 },
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rand = Math.random;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number, maxT: number) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return c < 0 ? 0 : -1;
  return t <= maxT ? t : -1;
}
function rayCylY(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, y0: number, y1: number, maxT: number) {
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (px * dx + pz * dz);
  const c = px * px + pz * pz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  let t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) { if (c < 0) t = 0; else return -1; }
  if (t > maxT) return -1;
  const y = oy + dy * t;
  if (y < y0 || y > y1) return -1;
  return t;
}

class Keys { down = new Set<string>(); pressed = new Set<string>(); }

export class Game {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(80, 1, 0.1, 1200);
  post: Post;
  fx: Fx;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  map!: MapData;
  world!: World;
  settings: Settings;
  cb: GameCallbacks;
  q = QUALITY.high;
  weather: Weather[] = [];
  envTex: THREE.Texture | null = null;
  pmrem: THREE.PMREMGenerator;
  envCache = new Map<string, THREE.Texture>();

  soldiers: Soldier[] = [];
  player!: Soldier;
  vm: ViewModel | null = null;
  projectiles: Projectile[] = [];
  grenades: Grenade[] = [];
  grenadePool: THREE.Mesh[] = [];
  pending: Pending[] = [];
  barrels: BarrelState[] = [];
  barrelMesh: THREE.InstancedMesh | null = null;
  barrelByCol = new Map<import("./world").Collider, BarrelState>();
  pts: PointState[] = [];
  flyers: { m: THREE.Group; v: THREE.Vector3; life: number }[] = [];

  cfg: MatchConfig = { mode: "conquest", map: "desert", team: 0, cls: "assault" };
  phase: "menu" | "deploy" | "playing" | "dead" | "ended" = "menu";
  paused = false;
  running = false;
  time = 0;
  matchT = 0;
  tickets: [number, number] = [300, 300];
  ticketsMax: [number, number] = [300, 300];
  stage = 0;
  ended: HudState["ended"] = null;
  feed: KillFeedItem[] = [];
  feedId = 0;
  message = "";
  messageT = 0;
  damageDirs: { a: number; t: number }[] = [];
  hitMarker = 0;
  hitKill = false;
  hitHead = false;
  respawnIn = 0;
  killedBy = "";
  visMul = 1;
  storm = 0;
  spawnSel = 0;
  nextArty = 6;
  nextFly = 10;
  hudT = 0;
  fps = 60;
  fpsAcc = 0;
  fpsN = 0;
  explFlash = 0;
  trauma = 0;
  thirdPerson = false;
  scoped = false;
  idCounter = 0;

  // player state
  keys = new Keys();
  mouseDown = [false, false, false];
  mouseDX = 0;
  mouseDY = 0;
  clickEdge = false;
  rcPitch = 0;
  rcTimer = 0;
  eyeSmooth = 1.6;
  bobT = 0;
  prevYaw = 0;
  prevPitch = 0;
  lastStepSide = 1;
  regenT = 0;
  focus = 40;
  expo = 1;
  prevGrounded = true;
  landVy = 0;
  camRoll = 0;
  camShot = { center: V(), ang: 0, radius: 30, height: 10, speed: 0.1, t: 0, dur: 12, tgt: V() };
  loading = false;
  raf = 0;
  lastT = 0;
  dtSmooth = 1 / 60;

  tmpV = V();
  tmpV2 = V();
  tmpV3 = V();
  sunUV = V();

  constructor(canvas: HTMLCanvasElement, settings: Settings, cb: GameCallbacks) {
    this.canvas = canvas;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.cb = cb;
    this.q = QUALITY[this.settings.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, stencil: false });
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.add(this.camera);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    this.scene.add(this.hemi);
    this.fx = new Fx(this.scene, this.q.fx);
    this.post = new Post(this.renderer, 640, 360, this.q.samples);
    this.applyRenderSettings();
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("blur", this.onBlur);
    initWeaponMaterials(this.q.tex);
    this.player = new Soldier(0, "YOU", 0, "assault", true, this.q.tex);
    (window as any).__game = this;
  }

  // ------------------------------------------------------------------ setup
  applyRenderSettings() {
    this.q = QUALITY[this.settings.quality];
    const s = this.settings;
    this.renderer.shadowMap.enabled = s.shadows;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== this.q.shadow) {
      sh.mapSize.set(this.q.shadow, this.q.shadow);
      sh.map?.dispose();
      (sh as any).map = null;
    }
    const R = this.q.shadowRange;
    sh.camera.left = -R; sh.camera.right = R; sh.camera.top = R; sh.camera.bottom = -R;
    sh.camera.near = 1; sh.camera.far = 400;
    sh.camera.updateProjectionMatrix();
    this.sun.castShadow = s.shadows;
    this.post.setSamples(this.q.samples);
    this.resize();
    audio.applySettings(s);
  }

  setSettings(s: Settings) {
    const qChanged = s.quality !== this.settings.quality;
    this.settings = { ...s };
    this.applyRenderSettings();
    if (qChanged && this.map) {
      // texture/geo quality needs a rebuild: flag for next map load
      this.mapDirty = true;
    }
  }
  mapDirty = false;
  disposed = false;

  resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pr) * this.settings.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  async loadMap(id: MapId) {
    if (this.map && this.map.id === id && !this.mapDirty) return;
    this.loading = true;
    await new Promise((r) => setTimeout(r, 40));
    if (this.disposed) return;
    if (this.map) {
      this.scene.remove(this.map.group, this.map.sky);
      this.map.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats as any[]) {
          for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "alphaMap"]) if (mt[k]) mt[k].dispose();
          mt.dispose();
        }
      });
      (this.map.sky.material as THREE.Material).dispose();
      for (const w of this.weather) { this.scene.remove(w.obj); }
      this.weather = [];
      if (this.barrelMesh) { this.scene.remove(this.barrelMesh); this.barrelMesh = null; }
      for (const p of this.pts) this.scene.remove(p.group);
      this.pts = [];
    }
    this.mapDirty = false;
    this.map = buildMap(id, this.q.tex, this.q.geo);
    this.world = this.map.world;
    const m = this.map;
    this.scene.add(m.group, m.sky);
    this.scene.fog = new THREE.FogExp2(m.fogColor.clone(), m.fogDensity);
    this.renderer.setClearColor(m.fogColor, 1);
    this.sun.color.copy(m.sunColor);
    this.sun.intensity = m.sunIntensity;
    this.hemi.color.copy(m.hemiSky);
    this.hemi.groundColor.copy(m.hemiGround);
    this.hemi.intensity = m.hemiI;
    this.fx.dust = m.dust;
    this.fx.snowy = m.snowy;
    this.fx.debris.ground = (x, z) => this.world.heightAt(x, z);
    this.fx.setFog(m.fogColor, m.fogDensity, m.particleTint);
    // environment (reflections) from the sky
    let env = this.envCache.get(id);
    if (!env) {
      const es = new THREE.Scene();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 20), (m.sky as THREE.Mesh).material as THREE.Material);
      es.add(mesh);
      env = this.pmrem.fromScene(es, 0.03, 0.1, 100).texture;
      this.envCache.set(id, env);
    }
    this.scene.environment = env;
    this.scene.environmentIntensity = m.envIntensity;
    // weather
    const boxSize = 70;
    for (const wcfg of m.weather) this.weather.push(new Weather(this.scene, wcfg.kind, Math.floor(wcfg.count * Math.max(0.4, this.q.fx)), boxSize));
    // barrels
    this.buildBarrels();
    audio.startAmbience(id, m.reverb);
    this.loading = false;
  }

  buildBarrels() {
    const m = this.map;
    this.barrels = [];
    this.barrelByCol.clear();
    if (!m.barrels.length) return;
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14);
    body.translate(0, 0.45, 0);
    parts.push(body);
    for (const y of [0.12, 0.45, 0.78]) {
      const r = new THREE.CylinderGeometry(0.325, 0.325, 0.05, 14);
      r.translate(0, y, 0);
      parts.push(r);
    }
    const top = new THREE.CylinderGeometry(0.2, 0.28, 0.04, 14);
    top.translate(0, 0.92, 0);
    parts.push(top);
    const geo = mergeGeometries(parts)!;
    const mat = pbrMat("metalRust", this.q.tex, { color: 0xc23c2a });
    const mesh = new THREE.InstancedMesh(geo, mat, m.barrels.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mx = new THREE.Matrix4();
    m.barrels.forEach((b, i) => {
      mx.makeTranslation(b.x, b.y, b.z);
      mesh.setMatrixAt(i, mx);
      const col = this.world.addCyl(b.x, b.z, 0.34, b.y, b.y + 0.95, "metal", true, "barrel");
      const st: BarrelState = { x: b.x, y: b.y, z: b.z, hp: 30, alive: true, col, i };
      this.barrels.push(st);
      this.barrelByCol.set(col, st);
    });
    this.barrelMesh = mesh;
    this.scene.add(mesh);
  }

  buildPoints() {
    for (const p of this.pts) this.scene.remove(p.group);
    this.pts = [];
    let defs: MapPointDef[] = this.map.points;
    if (this.cfg.mode === "assault") defs = this.map.assault;
    if (this.cfg.mode === "tdm") defs = [];
    defs.forEach((def, idx) => {
      const g = new THREE.Group();
      const y = this.world.heightAt(def.x, def.z);
      g.position.set(def.x, y, def.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(def.r - 0.7, def.r, 64),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.6;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(def.r, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.55;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.9, roughness: 0.35 }));
      pole.position.y = 4.5;
      pole.castShadow = true;
      const flagGeo = new THREE.PlaneGeometry(3.4, 1.9, 14, 4);
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), side: THREE.DoubleSide, toneMapped: false }));
      flag.position.set(1.7, 7.8, 0);
      const bg = new THREE.CylinderGeometry(1.4, 1.4, 90, 16, 1, true);
      bg.translate(0, 45, 0);
      const beam = new THREE.Mesh(
        bg,
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOp: { value: 0.3 } },
          vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
          fragmentShader: "varying vec2 vUv; uniform vec3 uColor; uniform float uOp; void main(){ float a = pow(1.0 - vUv.y, 1.6) * uOp; gl_FragColor = vec4(uColor * 1.8, a); }",
        })
      );
      g.add(ring, disc, pole, flag, beam);
      this.scene.add(g);
      const owner = this.cfg.mode === "assault" ? 1 : idx === 0 ? 0 : idx === defs.length - 1 ? 1 : -1;
      this.pts.push({ def, idx, owner, cap: owner === 0 ? 1 : owner === 1 ? -1 : 0, active: this.cfg.mode !== "assault" || idx === 0, assigned: 0, group: g, ring, beam, flag, flagGeo, y, contested: false });
    });
  }

  // ------------------------------------------------------------------ match
  async startMatch(cfg: MatchConfig, withPlayer: boolean) {
    this.cfg = cfg;
    await this.loadMap(cfg.map);
    // cleanup
    for (const s of this.soldiers) this.scene.remove(s.model.root);
    this.soldiers = [];
    this.projectiles = [];
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    this.pending = [];
    this.feed = [];
    this.ended = null;
    this.stage = 0;
    this.matchT = 0;
    this.messageT = 0;
    this.damageDirs = [];
    this.idCounter = 1;
    // restore barrels
    if (this.barrelMesh) {
      const mx = new THREE.Matrix4();
      for (const b of this.barrels) { b.alive = true; b.hp = 30; b.col.active = true; mx.makeTranslation(b.x, b.y, b.z); this.barrelMesh.setMatrixAt(b.i, mx); }
      this.barrelMesh.instanceMatrix.needsUpdate = true;
    }
    if (cfg.mode === "conquest") { this.tickets = [300, 300]; this.ticketsMax = [300, 300]; }
    else if (cfg.mode === "tdm") { this.tickets = [0, 0]; this.ticketsMax = [60, 60]; }
    else { this.tickets = [150, 999]; this.ticketsMax = [150, 150]; }
    this.buildPoints();
    // soldiers
    const n = this.settings.aiPerTeam;
    this.player.team = cfg.team;
    this.player.model.root.removeFromParent();
    this.player = new Soldier(0, "YOU", cfg.team, cfg.cls, true, this.q.tex);
    this.player.alive = false;
    this.player.model.root.visible = false;
    this.scene.add(this.player.model.root);
    this.soldiers.push(this.player);
    const pickCls = (): ClassId => { const r = rand(); return r < 0.4 ? "assault" : r < 0.6 ? "heavy" : r < 0.75 ? "sniper" : "breacher"; };
    for (let t = 0; t < 2; t++) {
      const cnt = t === cfg.team && withPlayer ? n - 1 : n;
      for (let i = 0; i < cnt; i++) {
        const s = new Soldier(this.idCounter++, (t === 0 ? NAMES0 : NAMES1)[i % 24], t, pickCls(), false, this.q.tex);
        s.ai!.squad = Math.floor(i / 4);
        s.alive = false;
        s.model.root.visible = false;
        this.scene.add(s.model.root);
        this.soldiers.push(s);
      }
    }
    this.rebuildViewmodel();
    this.thirdPerson = false;
    for (const s of this.soldiers) if (!s.isPlayer) this.respawn(s, true);
    this.phase = withPlayer ? "deploy" : "menu";
    this.spawnSel = 0;
    this.camShot.t = 99;
    this.paused = false;
    this.nextArty = 8;
    this.nextFly = 6;
    if (withPlayer) {
      this.msg(cfg.mode === "conquest" ? "CONQUEST — CAPTURE AND HOLD OBJECTIVES" : cfg.mode === "tdm" ? "TEAM DEATHMATCH — ELIMINATE THE ENEMY" : "OBJECTIVE ASSAULT — " + (cfg.team === 0 ? "BREAK THEIR LINES" : "HOLD THE LINE"));
    }
    audio.startMusic(withPlayer ? 0.55 : 0.3);
    if (!this.running) this.start();
  }

  rebuildViewmodel() {
    if (this.vm) this.camera.remove(this.vm.root);
    this.vm = new ViewModel(this.cfg.team, this.player.cls, this.q.tex);
    this.vm.root.visible = false;
    this.camera.add(this.vm.root);
    this.vm.setWeapon(this.player.w.def.id);
  }

  msg(t: string) { this.message = t; this.messageT = this.time + 3.2; }

  // spawn logic ---------------------------------------------------------
  spawnOptions(team: number): { id: number; name: string; pos: () => THREE.Vector3; yaw: number }[] {
    const opts: { id: number; name: string; pos: () => THREE.Vector3; yaw: number }[] = [];
    const yaw = team === 0 ? -Math.PI / 2 : Math.PI / 2;
    const base = () => { const l = this.map.spawns[team]; const s = l[Math.floor(rand() * l.length)]; return V(s.x + (rand() - 0.5) * 3, 0, s.z + (rand() - 0.5) * 3); };
    opts.push({ id: 0, name: "MAIN BASE", pos: base, yaw });
    const around = (p: MapPointDef, off: number) => () => { const a = rand() * 6.28; const r = off + rand() * 5; return V(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r); };
    if (this.cfg.mode === "conquest") {
      this.pts.forEach((p) => { if (p.owner === team && Math.abs(p.cap) > 0.95) opts.push({ id: p.idx + 1, name: "POINT " + p.def.letter, pos: around(p.def, 7), yaw }); });
    } else if (this.cfg.mode === "assault") {
      this.pts.forEach((p) => {
        if (team === 0 && p.idx < this.stage) opts.push({ id: p.idx + 1, name: p.def.name.toUpperCase() + " (SECURED)", pos: around(p.def, 7), yaw });
        if (team === 1 && p.idx > this.stage) opts.push({ id: p.idx + 1, name: p.def.name.toUpperCase() + " (REAR)", pos: around(p.def, 9), yaw });
      });
    } else {
      const f = this.map.points[team === 0 ? 1 : 3];
      opts.push({ id: 1, name: "FORWARD POSITION", pos: around(f, 8), yaw });
    }
    return opts;
  }

  placeOnGround(s: Soldier, p: THREE.Vector3) {
    for (let k = 0; k < 8; k++) {
      s.pos.set(p.x, 0, p.z);
      s.pos.y = this.world.heightAt(p.x, p.z) + 0.1;
      const col = this.world.collide(s.pos, 0.5, 1.8, 0.55);
      if (!col) break;
      p.x += (rand() - 0.5) * 6; p.z += (rand() - 0.5) * 6;
    }
    s.pos.y = this.world.groundAt(s.pos.x, s.pos.z, s.pos.y + 4, 4.5);
  }

  respawn(s: Soldier, initial = false) {
    const opts = this.spawnOptions(s.team);
    let o = opts[0];
    if (!s.isPlayer) {
      // AI picks a forward option often
      if (opts.length > 1 && rand() < 0.6) o = opts[1 + Math.floor(rand() * (opts.length - 1))];
      if (initial && rand() < 0.5) o = opts[0];
    } else o = opts.find((x) => x.id === this.spawnSel) || opts[0];
    const p = o.pos();
    this.placeOnGround(s, p);
    s.yaw = o.yaw + (rand() - 0.5) * 0.5;
    s.pitch = 0;
    s.vel.set(0, 0, 0);
    s.alive = true;
    s.hp = s.maxHp;
    s.crouch = false;
    s.deathT = 0;
    s.grounded = true;
    s.lastAttacker = null;
    s.weapons = CLASSES[s.cls].weapons.map((w) => makeWState(w));
    s.grenades = CLASSES[s.cls].grenades;
    s.cur = 0;
    s.model.setWeapon(s.weapons[0].def.id);
    s.model.resetPose();
    s.model.root.visible = !s.isPlayer || this.thirdPerson;
    s.ads = 0;
    if (s.ai) {
      const ai = s.ai;
      ai.state = "move"; ai.target = null; ai.seen = 99; ai.cover = null; ai.thinkT = rand() * 0.3; ai.skill = 0.75 + rand() * 0.5; ai.unstick = 0; ai.alertT = 0;
      ai.lastPos.copy(s.pos);
      this.assignGoal(s);
    }
    if (!initial) this.fx.add.emit({ x: s.pos.x, y: s.pos.y + 1, z: s.pos.z, life: 0.4, s0: 1, s1: 3, c0: s.team === 0 ? [0.5, 1.5, 4, 1] : [4, 0.8, 0.5, 1], c1: [0, 0, 0, 0], tile: 3 });
  }

  // ------------------------------------------------------------------ goals
  squadLeader(s: Soldier): Soldier | null {
    if (s.team === this.player.team && s.ai && s.ai.squad === 0 && this.player.alive && this.phase === "playing") return this.player;
    for (const o of this.soldiers) {
      if (o === s || o.isPlayer || o.team !== s.team || !o.alive || !o.ai) continue;
      if (o.ai.squad === s.ai!.squad && o.id < s.id) return o;
    }
    return null;
  }

  pickPoint(s: Soldier): number {
    if (!this.pts.length) return -1;
    let best = -1, bc = 1e9;
    for (const p of this.pts) {
      if (this.cfg.mode === "assault" && p.idx !== this.stage) continue;
      const d = Math.hypot(p.def.x - s.pos.x, p.def.z - s.pos.z);
      const enemyOwned = p.owner !== s.team;
      let cost = d * 0.6 + p.assigned * 35 + rand() * 30;
      if (!enemyOwned) cost += 90 - (p.contested ? 80 : 0);
      if (this.cfg.mode === "assault" && s.team === 1) cost = rand() * 10;
      if (cost < bc) { bc = cost; best = p.idx; }
    }
    return best;
  }

  assignGoal(s: Soldier) {
    const ai = s.ai!;
    if (this.pts.length && this.pts[ai.point]) this.pts[ai.point].assigned = Math.max(0, this.pts[ai.point].assigned - 1);
    const leader = this.squadLeader(s);
    if (leader && leader.alive) {
      const a = rand() * 6.28, r = 3 + rand() * 7;
      ai.goal.set(leader.pos.x + Math.cos(a) * r, 0, leader.pos.z + Math.sin(a) * r);
      ai.point = leader.ai ? leader.ai.point : 0;
      return;
    }
    if (this.cfg.mode === "tdm" || !this.pts.length) {
      const en = this.soldiers.filter((e) => e.alive && e.team !== s.team).sort((a, b) => a.pos.distanceToSquared(s.pos) - b.pos.distanceToSquared(s.pos));
      const e = en[Math.floor(rand() * Math.min(3, en.length))];
      if (e) ai.goal.set(e.pos.x + (rand() - 0.5) * 20, 0, e.pos.z + (rand() - 0.5) * 20);
      else ai.goal.set((rand() - 0.5) * 100, 0, (rand() - 0.5) * 100);
      return;
    }
    const idx = this.pickPoint(s);
    ai.point = Math.max(0, idx);
    const p = this.pts[ai.point];
    p.assigned++;
    const a = rand() * 6.28, r = rand() * p.def.r * 0.7;
    ai.goal.set(p.def.x + Math.cos(a) * r, 0, p.def.z + Math.sin(a) * r);
  }
  assignGoalHold(s: Soldier) {
    const ai = s.ai!;
    const p = this.pts[ai.point];
    const cx = p ? p.def.x : ai.goal.x, cz = p ? p.def.z : ai.goal.z;
    const r = p ? p.def.r * 0.9 : 8;
    // prefer a nearby cover point
    const cov = this.map.cover;
    for (let k = 0; k < 12 && cov.length; k++) {
      const c = cov[Math.floor(rand() * cov.length)];
      if (Math.hypot(c.x - cx, c.z - cz) < r + 6) { ai.goal.set(c.x, 0, c.z); return; }
    }
    const a = rand() * 6.28;
    ai.goal.set(cx + Math.cos(a) * rand() * r, 0, cz + Math.sin(a) * rand() * r);
  }

  // ------------------------------------------------------------------ physics
  moveSoldier(s: Soldier, dt: number, wx: number, wz: number, speed: number, jump: boolean) {
    const w = this.world;
    // accel
    const grounded = s.grounded;
    const accel = grounded ? 38 : 6;
    const tx = wx * speed, tz = wz * speed;
    const dx = tx - s.vel.x, dz = tz - s.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl > 0.001) {
      const a = Math.min(dl, accel * dt * (speed < 0.01 ? 1.4 : 1));
      s.vel.x += (dx / dl) * a;
      s.vel.z += (dz / dl) * a;
    }
    if (jump && grounded) { s.vel.y = 8.2; s.grounded = false; if (s.isPlayer) audio.jump(null); }
    s.vel.y -= 24 * dt;
    // horizontal move with slope check
    let nx = s.pos.x + s.vel.x * dt;
    let nz = s.pos.z + s.vel.z * dt;
    const r = 0.42;
    if (grounded) {
      const g1 = w.groundAt(nx, nz, s.pos.y, 0.6);
      if (g1 - s.pos.y > 0.58) {
        const g2 = w.groundAt(nx, s.pos.z, s.pos.y, 0.6);
        const g3 = w.groundAt(s.pos.x, nz, s.pos.y, 0.6);
        if (g2 - s.pos.y <= 0.58) { nz = s.pos.z; s.vel.z *= 0.5; }
        else if (g3 - s.pos.y <= 0.58) { nx = s.pos.x; s.vel.x *= 0.5; }
        else { nx = s.pos.x; nz = s.pos.z; s.vel.x = s.vel.z = 0; }
      }
    }
    s.pos.x = nx; s.pos.z = nz;
    w.collide(s.pos, r, s.height);
    // vertical
    s.pos.y += s.vel.y * dt;
    const gy = w.groundAt(s.pos.x, s.pos.z, s.pos.y, s.vel.y > 0 ? 0.05 : 0.6);
    const surf = w.lastSurface;
    if (s.pos.y <= gy + 0.001 || (grounded && s.vel.y <= 0 && s.pos.y - gy < 0.35)) {
      if (!grounded && s.vel.y < -6 && s.isPlayer) { this.landVy = s.vel.y; }
      s.pos.y = gy;
      if (s.vel.y < 0) s.vel.y = 0;
      s.grounded = true;
      s.surface = surf;
    } else s.grounded = false;
    // friction when no input
    if (speed < 0.01 && s.grounded) { const f = Math.max(0, 1 - dt * 12); s.vel.x *= f; s.vel.z *= f; }
  }

  // ------------------------------------------------------------------ combat
  muzzleWorld(s: Soldier, out: THREE.Vector3) {
    if (s.isPlayer && !this.thirdPerson && this.vm) {
      this.camera.updateMatrixWorld();
      return this.vm.muzzle.getWorldPosition(out);
    }
    const f = this.tmpV3.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const y = s.pos.y + (s.crouch ? 0.95 : 1.4);
    out.set(s.pos.x + f.x * 0.75 + f.z * 0.12, y, s.pos.z + f.z * 0.75 - f.x * 0.12);
    return out;
  }

  spawnProjectile(s: Soldier, origin: THREE.Vector3, dir: THREE.Vector3, spreadDeg: number) {
    const def = s.w.def;
    const col = def.bolt[s.team];
    const n = def.pellets;
    for (let i = 0; i < n; i++) {
      const d = this.tmpV2.copy(dir);
      const sp = (spreadDeg * Math.PI) / 180;
      const r = Math.sqrt(rand()) * sp, a = rand() * 6.28;
      // build orthonormal basis
      const up = Math.abs(d.y) > 0.99 ? V(1, 0, 0) : V(0, 1, 0);
      const right = V().crossVectors(d, up).normalize();
      const up2 = V().crossVectors(right, d).normalize();
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
      this.projectiles.push({ p: origin.clone(), v: d.clone().multiplyScalar(def.speed * (0.96 + rand() * 0.08)), owner: s, team: s.team, dmg: def.dmg, def, origin: origin.clone(), life: 2.4, col, tracer: true });
    }
  }

  spreadFor(s: Soldier): number {
    const w = s.w;
    const def = w.def;
    const speed = Math.hypot(s.vel.x, s.vel.z);
    let base = lerp(def.spread, def.adsSpread, s.ads);
    base *= 1 + Math.min(1.2, speed * 0.1);
    if (s.sprint) base *= 1.5;
    if (!s.grounded) base *= 2.2;
    if (s.crouch) base *= 0.7;
    return base + w.bloom;
  }

  fireWeapon(s: Soldier, origin: THREE.Vector3, dir: THREE.Vector3, spread: number) {
    const w = s.w;
    const def = w.def;
    if (def.energy) {
      w.heat += def.heat;
      if (w.heat >= 1) { w.heat = 1; w.overheated = true; if (s.isPlayer) this.msg("WEAPON OVERHEATED"); audio.empty(s.isPlayer ? null : s.pos); }
    } else w.ammo--;
    w.cd = 60 / def.rpm;
    w.bloom = Math.min(def.maxSpread, w.bloom + def.perShot);
    this.spawnProjectile(s, origin, dir, spread);
    const c = def.bolt[s.team];
    this.fx.muzzle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.muzzle, [Math.min(1, c[0] / 3), Math.min(1, c[1] / 3), Math.min(1, c[2] / 3)], s.isPlayer || this.camera.position.distanceTo(origin) < 40);
    const p = s.isPlayer ? null : s.pos;
    const near = !p || this.camera.position.distanceTo(s.pos) < 320;
    if (near) audio.fire(def.id, p ? { x: s.pos.x, y: s.pos.y + 1.4, z: s.pos.z } : null, s.team, s.isPlayer ? 1 : 0.9);
    s.fireAnim = 1;
    if (def.id === "sg12" || def.id === "lr50") w.cd = Math.max(w.cd, 60 / def.rpm);
    // shell/steam effects
    if (def.energy) this.fx.smoke.emit({ x: origin.x, y: origin.y + 0.1, z: origin.z, vy: 1, life: 0.6, s0: 0.1, s1: 0.4, c0: [0.8, 0.8, 0.9, 0.2 + w.heat * 0.3], c1: [0.8, 0.8, 0.9, 0], tile: 1 });
  }

  aiFire(s: Soldier, tx: number, ty: number, tz: number, errDeg: number) {
    const w = s.w;
    if (w.cd > 0 || w.reload >= 0) return;
    const o = this.muzzleWorld(s, this.tmpV);
    const origin = o.clone();
    const dir = V(tx - origin.x, ty - origin.y, tz - origin.z).normalize();
    this.fireWeapon(s, origin, dir, errDeg);
    if (w.ammo <= 0 && !w.def.energy) this.startReload(s);
  }

  startReload(s: Soldier) {
    const w = s.w;
    if (w.def.energy || w.reload >= 0 || w.ammo >= w.def.mag) return;
    if (s.isPlayer && w.reserve <= 0) return;
    w.reload = 0;
    audio.reload(w.def.id, w.def.reload, s.isPlayer ? null : { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
  }

  switchWeapon(s: Soldier, idx: number) {
    if (idx === s.cur || idx < 0 || idx >= s.weapons.length) return;
    s.weapons[s.cur].reload = -1;
    s.cur = idx;
    s.switchT = 0.45;
    s.model.setWeapon(s.w.def.id);
    s.ads = 0;
    if (s.isPlayer) {
      this.vm?.setWeapon(s.w.def.id);
      audio.switchWeapon(null);
    }
  }

  throwGrenade(s: Soldier, vx: number, vy: number, vz: number) {
    if (s.grenades <= 0) return;
    s.grenades--;
    let mesh = this.grenadePool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.4, metalness: 0.8, emissive: new THREE.Color(0.2, 0.0, 0.0) }));
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), toneMapped: false }));
      led.position.y = 0.1;
      mesh.add(led);
      mesh.castShadow = true;
    }
    this.scene.add(mesh);
    const p = V(s.pos.x, s.eyeY - 0.1, s.pos.z);
    this.grenades.push({ p, v: V(vx, vy, vz), owner: s, fuse: 2.6, beep: 0, mesh, rest: false });
    audio.grenadeThrow(s.isPlayer ? null : { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z });
  }

  playerGrenade() {
    const p = this.player;
    if (!p.alive || p.grenades <= 0) return;
    const f = this.camera.getWorldDirection(this.tmpV2);
    this.throwGrenade(p, f.x * 17 + p.vel.x * 0.5, f.y * 17 + 4.0 + p.vel.y * 0.2, f.z * 17 + p.vel.z * 0.5);
  }

  hitTest(p0: THREE.Vector3, d: THREE.Vector3, len: number, e: Soldier): { t: number; head: boolean } | null {
    const hh = e.crouch ? 1.38 : 1.52;
    const th = raySphere(p0.x, p0.y, p0.z, d.x, d.y, d.z, e.pos.x, e.headY, e.pos.z, 0.2, len);
    const tb = rayCylY(p0.x, p0.y, p0.z, d.x, d.y, d.z, e.pos.x, e.pos.z, 0.36, e.pos.y, e.pos.y + hh, len);
    if (th < 0 && tb < 0) return null;
    if (th >= 0 && (tb < 0 || th <= tb + 0.05)) return { t: th, head: true };
    return { t: tb, head: false };
  }

  updateProjectiles(dt: number) {
    const bolts = this.fx.bolts;
    bolts.begin();
    const camP = this.camera.position;
    const dirv = this.tmpV2;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      const sl = pr.v.length();
      const len = sl * dt;
      dirv.copy(pr.v).divideScalar(sl);
      let bestT = len, kind = 0; // 0 none, 1 world, 2 soldier
      let wh: ReturnType<World["raycast"]> = null;
      wh = this.world.raycast(pr.p.x, pr.p.y, pr.p.z, dirv.x, dirv.y, dirv.z, len);
      if (wh) { bestT = wh.t; kind = 1; }
      let hs: Soldier | null = null, hHead = false;
      for (const e of this.soldiers) {
        if (!e.alive || e.team === pr.team) continue;
        const dx = e.pos.x - pr.p.x, dz = e.pos.z - pr.p.z;
        if (dx * dx + dz * dz > (len + 3) * (len + 3)) continue;
        const h = this.hitTest(pr.p, dirv, bestT, e);
        if (h && h.t < bestT) { bestT = h.t; kind = 2; hs = e; hHead = h.head; }
      }
      // near-miss whiz for the player
      if (pr.owner !== this.player && this.player.alive && pr.team !== this.player.team) {
        const dxp = this.player.pos.x - pr.p.x, dzp = this.player.pos.z - pr.p.z;
        if (dxp * dxp + dzp * dzp < 36 && kind !== 2) { this.suppress = Math.min(1, this.suppress + 0.08); }
      }
      const hx = pr.p.x + dirv.x * bestT, hy = pr.p.y + dirv.y * bestT, hz = pr.p.z + dirv.z * bestT;
      if (kind === 2 && hs) {
        const dist = pr.origin.distanceTo(pr.p) + bestT;
        const f = pr.def.falloff;
        const mul = dist < f[0] ? 1 : lerp(1, f[2], clamp((dist - f[0]) / (f[1] - f[0]), 0, 1));
        let dmg = pr.dmg * mul * (hHead ? pr.def.head : 1);
        if (hs.isPlayer) dmg *= 0.8;
        this.damage(hs, dmg, pr.owner, pr.def.name, hHead, hx, hy, hz, dirv.x, dirv.z);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (kind === 1 && wh) {
        const surf = wh.surface;
        this.fx.impact(hx, hy, hz, wh.nx, wh.ny, wh.nz, surf, pr.col);
        if (camP.distanceToSquared(pr.p) < 70 * 70) audio.impact(surf, { x: hx, y: hy, z: hz });
        if (wh.collider && wh.collider.tag === "barrel") {
          const b = this.barrelByCol.get(wh.collider);
          if (b) this.damageBarrel(b, pr.dmg * (pr.def.pellets > 1 ? 1.5 : 1), pr.owner);
        }
        this.projectiles.splice(i, 1);
        continue;
      }
      pr.p.addScaledVector(dirv, len);
      if (pr.life <= 0 || Math.hypot(pr.p.x, pr.p.z) > 420 || pr.p.y > 400) { this.projectiles.splice(i, 1); continue; }
      const c = pr.col;
      bolts.add(pr.p.x - dirv.x * pr.def.boltLen * 0.5, pr.p.y - dirv.y * pr.def.boltLen * 0.5, pr.p.z - dirv.z * pr.def.boltLen * 0.5, dirv.x, dirv.y, dirv.z, pr.def.boltLen, c[0], c[1], c[2], pr.def.boltThick);
    }
    bolts.end();
  }
  suppress = 0;

  damageBarrel(b: BarrelState, dmg: number, owner: Soldier | null) {
    if (!b.alive) return;
    b.hp -= dmg;
    if (b.hp > 0) return;
    b.alive = false;
    b.col.active = false;
    if (this.barrelMesh) {
      const m = new THREE.Matrix4().makeScale(0, 0, 0);
      this.barrelMesh.setMatrixAt(b.i, m);
      this.barrelMesh.instanceMatrix.needsUpdate = true;
    }
    this.pending.push({ t: this.time + 0.08 + rand() * 0.1, fn: () => this.explode(b.x, b.y + 0.5, b.z, 7.5, 140, owner, 0.9, "FUEL BARREL") });
  }

  explode(x: number, y: number, z: number, radius: number, dmg: number, owner: Soldier | null, size: number, name: string) {
    this.fx.explosion(x, y, z, size, size > 1.2);
    audio.explosion({ x, y, z }, size);
    const d = this.camera.position.distanceTo(this.tmpV.set(x, y, z));
    this.trauma = Math.min(1, this.trauma + 0.9 / (1 + d / 14) * (this.map.shake));
    this.explFlash = Math.min(1, this.explFlash + (d < 25 ? 0.5 : 0.1));
    for (const e of this.soldiers) {
      if (!e.alive) continue;
      const dx = e.pos.x - x, dz = e.pos.z - z, dy = e.pos.y + 1 - y;
      const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dd > radius) continue;
      if (dd > 2 && !this.world.los(x, y + 0.3, z, e.pos.x, e.pos.y + 1, e.pos.z)) continue;
      if (owner && e.team === owner.team && e !== owner) continue;
      const amt = dmg * Math.pow(1 - dd / radius, 1.1);
      if (amt < 1) continue;
      this.damage(e, amt, owner || e, name, false, e.pos.x, e.pos.y + 1, e.pos.z, dx / (dd || 1), dz / (dd || 1));
      if (e.alive || true) { e.vel.x += (dx / (dd || 1)) * 6 * (1 - dd / radius); e.vel.z += (dz / (dd || 1)) * 6 * (1 - dd / radius); if (e.grounded && dd < 5) { e.vel.y = 4; e.grounded = false; } }
    }
    for (const b of this.barrels) {
      if (!b.alive) continue;
      const dd = Math.hypot(b.x - x, b.y - y, b.z - z);
      if (dd < radius && dd > 0.5) this.damageBarrel(b, 200 * (1 - dd / radius) + 20, owner);
    }
    this.fx.scorch.add(x, this.world.heightAt(x, z) + 0.04, z, 0, 1, 0, radius * 0.9);
  }

  damage(t: Soldier, amount: number, attacker: Soldier, wname: string, head: boolean, hx: number, hy: number, hz: number, dx: number, dz: number) {
    if (!t.alive) return;
    t.hp -= amount;
    t.lastDmgT = this.time;
    t.lastAttacker = attacker;
    t.hurt = 1;
    const sparkCol: [number, number, number] = t.team === 0 ? [0.4, 0.8, 1] : [1, 0.5, 0.2];
    this.fx.blood(hx, hy, hz, -dx, 0.3, -dz, sparkCol);
    this.fx.impact(hx, hy, hz, -dx, 0.2, -dz, "body", null);
    if (attacker !== t && attacker.isPlayer) {
      this.hitMarker = this.time; this.hitHead = head; this.hitKill = false;
      audio.ui(head ? "headshot" : "hit");
    }
    if (t.isPlayer) {
      this.regenT = 0;
      const a = Math.atan2(-(attacker.pos.x - t.pos.x), -(attacker.pos.z - t.pos.z));
      this.damageDirs.push({ a: a - t.yaw, t: this.time });
      audio.hurt(null, t.team);
      this.trauma = Math.min(1, this.trauma + 0.25 + amount * 0.005);
      this.dmgFlash = Math.min(1, this.dmgFlash + amount / 60);
    } else if (t.ai) {
      t.ai.alertT = 6;
      if (attacker !== t) {
        t.ai.lastKnown.copy(attacker.pos);
        t.ai.seen = Math.min(t.ai.seen, 1.5);
        if (!t.ai.target || !t.ai.target.alive) { t.ai.target = attacker; t.ai.react = 0.2; t.ai.state = "engage"; }
      }
      if (rand() < 0.3 && this.camera.position.distanceTo(t.pos) < 60) audio.hurt({ x: t.pos.x, y: t.pos.y + 1.5, z: t.pos.z }, t.team);
    }
    if (t.hp <= 0) this.kill(t, attacker, wname, head);
  }
  dmgFlash = 0;

  kill(t: Soldier, k: Soldier, wname: string, head: boolean) {
    t.alive = false;
    t.deathT = 0;
    t.deathType = Math.floor(rand() * 4);
    t.deaths++;
    t.ads = 0;
    t.respawnT = 5 + rand() * 4;
    t.streak = 0;
    const selfKill = k === t;
    if (!selfKill) { k.kills++; k.score += head ? 150 : 100; k.streak++; }
    if (this.cfg.mode === "conquest") { if (this.tickets[t.team] > 0) this.tickets[t.team]--; }
    else if (this.cfg.mode === "tdm") { this.tickets[selfKill ? 1 - t.team : k.team]++; }
    else if (this.cfg.mode === "assault" && t.team === 0) { this.tickets[0]--; }
    this.feed.push({ id: this.feedId++, killer: selfKill ? t.name : k.name, victim: t.name, weapon: wname, kTeam: k.team, vTeam: t.team, headshot: head, t: this.time });
    if (this.feed.length > 6) this.feed.shift();
    audio.death(t.isPlayer ? null : { x: t.pos.x, y: t.pos.y + 1.2, z: t.pos.z }, t.team);
    this.fx.smokePuff(t.pos.x, t.pos.y + 1, t.pos.z, 0.25, 0.3);
    this.fx.sparkShower(t.pos.x, t.pos.y + 1.2, t.pos.z, 8);
    if (k.isPlayer && !selfKill) {
      this.hitKill = true; this.hitMarker = this.time;
      audio.ui("kill");
      this.msg(head ? "HEADSHOT — " + t.name : "ELIMINATED " + t.name);
    }
    if (t.isPlayer) {
      this.phase = "dead";
      this.respawnIn = 5;
      this.killedBy = k.name + (wname ? " — " + wname : "");
      this.thirdPerson = false;
      t.model.root.visible = true;
      this.vm && (this.vm.root.visible = false);
      this.camShot.t = 99;
      this.scoped = false;
    }
  }

  // ------------------------------------------------------------------ player
  deploy(cls: ClassId, spawnId: number) {
    if (this.phase !== "deploy" && !(this.phase === "dead" && this.respawnIn <= 0)) return;
    this.cfg.cls = cls;
    this.spawnSel = spawnId;
    const p = this.player;
    p.setClass(cls);
    this.respawn(p);
    p.model.root.visible = false;
    this.rebuildViewmodel();
    this.phase = "playing";
    this.eyeSmooth = 1.6;
    this.rcPitch = 0;
    this.keys.down.clear();
    this.lockPointer();
    audio.ui("deploy");
    audio.startMusic(0.6);
    this.paused = false;
  }

  lockPointer() {
    try { const r = this.canvas.requestPointerLock() as unknown; if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => { /* ignored */ }); } catch { /* ignore */ }
  }

  updatePlayer(dt: number) {
    const p = this.player;
    const w = p.w;
    const def = w.def;
    const k = this.keys.down;
    // look
    const adsZoom = lerp(1, def.zoom, p.ads);
    const sens = 0.0021 * this.settings.sensitivity * lerp(1, this.settings.adsSensitivity / Math.sqrt(adsZoom), p.ads);
    p.yaw -= this.mouseDX * sens;
    p.pitch -= this.mouseDY * sens * (this.settings.invertY ? -1 : 1);
    this.mouseDX = this.mouseDY = 0;
    p.pitch = clamp(p.pitch, -1.5, 1.5);
    const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const str = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    p.crouch = k.has("ControlLeft") || k.has("KeyC");
    // can't stand if blocked? ignore
    const wantSprint = k.has("ShiftLeft") && fwd > 0 && !p.crouch && w.reload < 0 && this.mouseDown[2] === false;
    p.sprint = wantSprint;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let wx = -sy * fwd + cy * str;
    let wz = -cy * fwd - sy * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let speed = (p.crouch ? 2.5 : p.sprint ? 7.4 : 4.7) * p.speedMul * def.moveMul;
    speed *= lerp(1, 0.62, p.ads);
    if (wl < 0.01) speed = 0;
    const jump = k.has("Space");
    this.moveSoldier(p, dt, wx, wz, speed, jump);
    p.strafeAmt = str;
    // ads
    const wantAds = this.mouseDown[2] && !p.sprint && w.reload < 0 && p.switchT <= 0.1;
    p.ads += ((wantAds ? 1 : 0) - p.ads) * Math.min(1, dt * (def.scope ? 7 : 10));
    // weapon
    p.switchT = Math.max(0, p.switchT - dt);
    const wantFire = (this.mouseDown[0] && (def.auto || this.clickEdge)) && !p.sprint && p.switchT <= 0 && this.phase === "playing";
    if (wantFire) {
      if (w.reload >= 0) { /* can't */ }
      else if (def.energy && w.overheated) { if (this.clickEdge) audio.empty(null); }
      else if (!def.energy && w.ammo <= 0) { if (this.clickEdge) audio.empty(null); this.startReload(p); }
      else if (w.cd <= 0) this.playerFire();
    }
    this.clickEdge = false;
    if (this.keys.pressed.has("KeyR")) this.startReload(p);
    if (this.keys.pressed.has("Digit1")) this.switchWeapon(p, 0);
    if (this.keys.pressed.has("Digit2")) this.switchWeapon(p, 1);
    if (this.keys.pressed.has("Digit3")) this.switchWeapon(p, 2);
    if (this.keys.pressed.has("KeyG")) this.playerGrenade();
    if (this.keys.pressed.has("KeyV")) { this.thirdPerson = !this.thirdPerson; p.model.root.visible = this.thirdPerson; }
    // recoil recovery
    this.rcTimer -= dt;
    if (this.rcTimer < 0 && this.rcPitch > 0) {
      const rec = this.rcPitch * Math.min(1, dt * 5) + 0.002;
      const r = Math.min(this.rcPitch, rec);
      p.pitch -= r;
      this.rcPitch -= r;
    }
    // regen
    this.regenT += dt;
    if (this.regenT > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 16 * dt);
    // landing
    if (this.landVy < -0.1) {
      audio.land(p.surface, this.landVy < -11, null);
      this.eyeSmooth -= Math.min(0.35, -this.landVy * 0.03);
      this.landVy = 0;
    }
    // footsteps
    const st = p.model.stepCount;
    if (st > 0 && p.grounded) {
      audio.footstep(p.surface, p.sprint, null);
      if (this.map.snowy && p.surface === "snow") {
        this.lastStepSide *= -1;
        this.fx.footprint(p.pos.x + Math.cos(p.yaw) * 0.14 * this.lastStepSide, p.pos.y, p.pos.z - Math.sin(p.yaw) * 0.14 * this.lastStepSide, p.yaw);
      }
    }
  }

  playerFire() {
    const p = this.player;
    const w = p.w;
    const def = w.def;
    this.camera.updateMatrixWorld();
    const cdir = this.camera.getWorldDirection(this.tmpV2).clone();
    const cpos = this.camera.position.clone();
    // convergence point
    const hit = this.world.raycast(cpos.x, cpos.y, cpos.z, cdir.x, cdir.y, cdir.z, 300);
    let hitT = hit ? hit.t : 300;
    for (const e of this.soldiers) {
      if (!e.alive || e.team === p.team) continue;
      const h = this.hitTest(cpos, cdir, hitT, e);
      if (h && h.t < hitT) hitT = h.t;
    }
    const target = cpos.clone().addScaledVector(cdir, Math.max(hitT, 4));
    const origin = this.muzzleWorld(p, V());
    if (this.thirdPerson) origin.copy(this.muzzleWorld(p, V()));
    const dir = target.sub(origin).normalize();
    const spread = this.spreadFor(p);
    this.fireWeapon(p, origin, dir, spread);
    // recoil
    const adsMul = lerp(1, 0.6, p.ads);
    const kp = ((def.recoilP * (0.8 + rand() * 0.4)) * Math.PI) / 180 * adsMul;
    p.pitch += kp;
    this.rcPitch += kp * 0.7;
    p.yaw += ((rand() - 0.5) * 2 * def.recoilY * Math.PI) / 180 * adsMul;
    this.rcTimer = 0.12;
    this.vm && (this.vm.kick = 1);
    this.trauma = Math.min(1, this.trauma + def.recoilP * 0.015);
    if (!def.energy && w.ammo <= 0 && w.reserve > 0) { /* auto reload next press */ }
  }

  updateWeaponState(s: Soldier, dt: number) {
    for (const w of s.weapons) {
      w.cd = Math.max(0, w.cd - dt);
      w.bloom = Math.max(0, w.bloom - dt * 2.4);
      if (w.def.energy) {
        w.heat = Math.max(0, w.heat - dt * w.def.cool * (w.cd > 0.2 ? 0.2 : 1));
        if (w.overheated && w.heat < 0.35) w.overheated = false;
      }
    }
    const w = s.w;
    if (w.reload >= 0) {
      w.reload += dt;
      if (w.reload >= w.def.reload) {
        const need = w.def.mag - w.ammo;
        if (s.isPlayer) { const take = Math.min(need, w.reserve); w.ammo += take; w.reserve -= take; }
        else w.ammo = w.def.mag;
        w.reload = -1;
      }
    }
  }

  // ------------------------------------------------------------------ grenades
  updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.beep -= dt;
      if (g.beep <= 0) { g.beep = Math.max(0.12, g.fuse * 0.22); audio.grenadeBeep({ x: g.p.x, y: g.p.y, z: g.p.z }); }
      if (!g.rest) {
        g.v.y -= 22 * dt;
        const len = g.v.length() * dt;
        const d = this.tmpV2.copy(g.v).normalize();
        const hit = this.world.raycast(g.p.x, g.p.y, g.p.z, d.x, d.y, d.z, len + 0.12);
        if (hit && hit.t <= len + 0.1) {
          g.p.addScaledVector(d, Math.max(0, hit.t - 0.1));
          const n = this.tmpV3.set(hit.nx, hit.ny, hit.nz);
          const vn = g.v.dot(n);
          g.v.addScaledVector(n, -2 * vn).multiplyScalar(0.45);
          g.v.x *= 0.8; g.v.z *= 0.8;
          if (Math.abs(vn) > 3) audio.grenadeBounce({ x: g.p.x, y: g.p.y, z: g.p.z });
          if (g.v.length() < 1.5 && hit.ny > 0.5) { g.rest = true; g.v.set(0, 0, 0); }
        } else g.p.addScaledVector(d, len);
        // hit soldiers? roll only
      }
      g.mesh.position.copy(g.p);
      g.mesh.rotation.x += dt * 8;
      if (g.fuse <= 0) {
        this.explode(g.p.x, g.p.y + 0.2, g.p.z, 9.5, 190, g.owner, 1.15, "THERMAL DETONATOR");
        this.scene.remove(g.mesh);
        this.grenadePool.push(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ modes
  updateMode(dt: number) {
    if (this.ended) return;
    if (this.phase === "menu") { this.tickets = [this.ticketsMax[0], this.ticketsMax[1]]; if (this.cfg.mode === "tdm") this.tickets = [0, 0]; }
    this.matchT += dt;
    const mode = this.cfg.mode;
    if (mode === "conquest" || mode === "assault") {
      for (const p of this.pts) {
        if (!p.active && mode === "assault") continue;
        let n0 = 0, n1 = 0;
        for (const s of this.soldiers) {
          if (!s.alive) continue;
          const dx = s.pos.x - p.def.x, dz = s.pos.z - p.def.z;
          if (dx * dx + dz * dz < p.def.r * p.def.r && Math.abs(s.pos.y - p.y) < 8) { if (s.team === 0) n0++; else n1++; }
        }
        const diff = Math.min(4, Math.abs(n0 - n1));
        p.contested = n0 > 0 && n1 > 0;
        const prevOwner = p.owner;
        if (n0 > n1) p.cap = Math.min(1, p.cap + diff * 0.045 * dt * (mode === "assault" ? 1.15 : 1));
        else if (n1 > n0) p.cap = Math.max(-1, p.cap - diff * 0.045 * dt);
        if (p.cap >= 0.999) p.owner = 0;
        else if (p.cap <= -0.999) p.owner = 1;
        else if (p.owner === 0 && p.cap < 0.05) p.owner = -1;
        else if (p.owner === 1 && p.cap > -0.05) p.owner = -1;
        if (p.owner !== prevOwner) {
          const friendly = p.owner === this.player.team;
          const lost = prevOwner === this.player.team && p.owner !== this.player.team;
          if (mode === "assault") {
            if (p.owner === 0) {
              this.stage++;
              p.owner = 0;
              this.msg("OBJECTIVE SECURED");
              audio.ui(this.player.team === 0 ? "capture" : "alarm");
              const nx = this.pts[this.stage];
              if (nx) nx.active = true;
              else this.endMatch(0, "ATTACKERS BREACHED THE DEFENCES");
              for (const s of this.soldiers) if (s.ai && s.alive) s.ai.repathT = 0;
            }
          } else {
            if (p.owner >= 0) this.msg((friendly ? "CAPTURED " : "ENEMY CAPTURED ") + "POINT " + p.def.letter);
            else if (lost) this.msg("LOST POINT " + p.def.letter);
            if (friendly || lost) audio.ui(friendly ? "capture" : "alarm");
            // award capture score
            if (p.owner >= 0) for (const s of this.soldiers) if (s.alive && s.team === p.owner && Math.hypot(s.pos.x - p.def.x, s.pos.z - p.def.z) < p.def.r) s.score += 150;
          }
        }
      }
      if (mode === "conquest") {
        let c0 = 0, c1 = 0;
        for (const p of this.pts) { if (p.owner === 0) c0++; else if (p.owner === 1) c1++; }
        const d = c0 - c1;
        if (d > 0) this.tickets[1] = Math.max(0, this.tickets[1] - d * 0.3 * dt);
        else if (d < 0) this.tickets[0] = Math.max(0, this.tickets[0] + d * 0.3 * dt);
        if (this.tickets[0] <= 0) this.endMatch(1, "AEGIS COALITION TICKETS DEPLETED");
        else if (this.tickets[1] <= 0) this.endMatch(0, "DOMINION LEGION TICKETS DEPLETED");
        else if (this.matchT > 1500) this.endMatch(this.tickets[0] >= this.tickets[1] ? 0 : 1, "TIME LIMIT REACHED");
      } else {
        if (this.tickets[0] <= 0) this.endMatch(1, "ATTACKERS OUT OF REINFORCEMENTS");
        else if (this.matchT > 780) this.endMatch(1, "DEFENDERS HELD THE LINE");
      }
    } else {
      if (this.tickets[0] >= this.ticketsMax[0]) this.endMatch(0, "AEGIS COALITION REACHED " + this.ticketsMax[0] + " ELIMINATIONS");
      else if (this.tickets[1] >= this.ticketsMax[1]) this.endMatch(1, "DOMINION LEGION REACHED " + this.ticketsMax[1] + " ELIMINATIONS");
      else if (this.matchT > 600) this.endMatch(this.tickets[0] >= this.tickets[1] ? 0 : 1, "TIME EXPIRED");
    }
  }

  endMatch(winner: number, text: string) {
    if (this.ended || this.phase === "menu") return;
    this.ended = { winner, text };
    this.phase = "ended";
    audio.ui(winner === this.player.team ? "win" : "lose");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ------------------------------------------------------------------ ambient events
  updateAmbient(dt: number) {
    this.nextArty -= dt;
    if (this.nextArty <= 0) {
      this.nextArty = 5 + rand() * 9;
      const c = this.camera.position;
      const near = rand() < 0.15;
      const a = rand() * 6.28, r = near ? 45 + rand() * 30 : 90 + rand() * 120;
      let x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const rr = Math.hypot(x, z);
      if (rr > 225) { x *= 225 / rr; z *= 225 / rr; }
      const y = this.world.heightAt(x, z);
      // screen-visible streak of an incoming shell
      this.fx.add.emit({ x, y: y + 80, z, vy: -80, life: 0.8, s0: 0.5, s1: 0.2, c0: [4, 2, 0.8, 1], c1: [1, 0.2, 0, 0], stretch: 2, tile: 3 });
      this.pending.push({ t: this.time + 0.7, fn: () => this.explode(x, y, z, 11, near ? 120 : 60, null, 1.6, "ARTILLERY") });
    }
    this.nextFly -= dt;
    if (this.nextFly <= 0) {
      this.nextFly = 16 + rand() * 20;
      this.spawnFlyers();
    }
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.m.position.addScaledVector(f.v, dt);
      f.life -= dt;
      this.fx.add.emit({ x: f.m.position.x, y: f.m.position.y, z: f.m.position.z, life: 0.5, s0: 1.4, s1: 0.2, c0: [1.5, 1.5, 2.5, 0.6], c1: [0, 0, 0, 0], tile: 3 });
      if (f.life <= 0) { this.scene.remove(f.m); this.flyers.splice(i, 1); }
    }
  }

  spawnFlyers() {
    const c = this.camera.position;
    const ang = rand() * 6.28;
    const dir = V(Math.cos(ang), 0, Math.sin(ang));
    const side = V(-dir.z, 0, dir.x);
    const off = (rand() < 0.5 ? -1 : 1) * (60 + rand() * 160);
    const alt = 70 + rand() * 90;
    const start = V(c.x - dir.x * 520 + side.x * off, alt, c.z - dir.z * 520 + side.z * off);
    const team = rand() < 0.5 ? 0 : 1;
    const speed = 130 + rand() * 50;
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const m = buildFighter(team);
      m.position.copy(start).addScaledVector(dir, -i * 18).addScaledVector(side, (i % 2 ? 1 : -1) * i * 14);
      m.position.y += i * 3;
      m.lookAt(m.position.clone().add(dir));
      m.rotateY(Math.PI);
      m.traverse((o) => { const mm = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (mm) mm.fog = false; });
      this.scene.add(m);
      this.flyers.push({ m, v: dir.clone().multiplyScalar(speed), life: 1100 / speed });
    }
    const tClose = 520 / speed;
    const closest = V(start.x + dir.x * 520, alt, start.z + dir.z * 520);
    setTimeout(() => audio.flyby({ x: closest.x, y: closest.y, z: closest.z }, 1), Math.max(0, (tClose - 2.4) * 1000));
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt: number) {
    const cam = this.camera;
    const p = this.player;
    const s = this.settings;
    const playing = this.phase === "playing" && p.alive;
    let fov = s.fov;
    if (playing) {
      const def = p.w.def;
      const zoom = lerp(1, def.zoom, p.ads);
      fov = s.fov / zoom;
      const targetEye = p.crouch ? 1.15 : 1.62;
      this.eyeSmooth = lerp(this.eyeSmooth, targetEye, Math.min(1, dt * 11));
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (p.grounded && speed > 0.5) this.bobT += dt * (5 + speed * 1.3);
      const bob = Math.sin(this.bobT * 2) * 0.012 * Math.min(1, speed / 6) * (1 - p.ads * 0.8);
      const eyeY = p.pos.y + this.eyeSmooth + bob;
      // shake
      const tr = this.trauma * this.trauma;
      const t = this.time * 30;
      const sx = (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * 0.5 * tr * 0.05;
      const sy = (Math.sin(t * 1.7 + 2) + Math.sin(t * 3.1)) * 0.5 * tr * 0.05;
      const sr = Math.sin(t * 1.1) * tr * 0.04;
      this.camRoll = lerp(this.camRoll, -p.strafeAmt * 0.012 * (1 - p.ads), Math.min(1, dt * 6));
      if (!this.thirdPerson) {
        cam.position.set(p.pos.x, eyeY, p.pos.z);
        cam.rotation.set(p.pitch + sx, p.yaw + sy, this.camRoll + sr, "YXZ");
      } else {
        const ox = 0.55, oy = 0.25, oz = 3.2 * (1 - p.ads * 0.5);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, "YXZ"));
        const off = V(ox, oy, oz).applyQuaternion(q);
        const head = V(p.pos.x, eyeY, p.pos.z);
        const len = off.length();
        const dirn = off.clone().normalize();
        const hit = this.world.raycast(head.x, head.y, head.z, dirn.x, dirn.y, dirn.z, len + 0.3);
        const dd = hit ? Math.max(0.4, hit.t - 0.3) : len;
        cam.position.copy(head).addScaledVector(dirn, dd);
        cam.rotation.set(p.pitch + sx, p.yaw + sy, sr, "YXZ");
      }
      this.scoped = def.scope && p.ads > 0.9 && !this.thirdPerson;
      // view model
      if (this.vm) {
        this.vm.root.visible = !this.thirdPerson && !this.scoped;
        const w = p.w;
        this.vm.update(dt, {
          ads: p.ads, moveSpeed: Math.hypot(p.vel.x, p.vel.z), sprint: p.sprint, mouseDX: this.lastMX, mouseDY: this.lastMY,
          reload: w.reload >= 0 ? w.reload / w.def.reload : -1, grounded: p.grounded, crouch: p.crouch,
        });
      }
    } else {
      // cinematic orbit
      this.vm && (this.vm.root.visible = false);
      this.scoped = false;
      const c = this.camShot;
      c.t += dt;
      if (c.t > c.dur) this.newShot();
      c.ang += c.speed * dt;
      let cx = c.center.x, cz = c.center.z;
      if (this.phase === "dead") { cx = p.pos.x; cz = p.pos.z; }
      const cy0 = this.world.heightAt(cx, cz);
      const px = cx + Math.cos(c.ang) * c.radius, pz = cz + Math.sin(c.ang) * c.radius;
      const py = Math.max(this.world.heightAt(px, pz) + 2.5, cy0 + c.height);
      cam.position.lerp(V(px, py, pz), Math.min(1, dt * (c.t < 0.2 ? 20 : 3)));
      const look = V(cx, cy0 + 1.8, cz);
      cam.lookAt(look);
      fov = 62;
      this.focus = cam.position.distanceTo(look);
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = lerp(cam.fov, fov, Math.min(1, dt * 14)); cam.updateProjectionMatrix(); }
  }
  lastMX = 0;
  lastMY = 0;

  newShot() {
    const c = this.camShot;
    c.t = 0;
    c.dur = 10 + rand() * 6;
    // choose a hotspot: an engaged soldier or a point
    const engaged = this.soldiers.filter((s) => s.alive && s.ai && s.ai.target && s.ai.seen < 1.5);
    let cx: number, cz: number;
    if (engaged.length && rand() < 0.75) { const e = engaged[Math.floor(rand() * engaged.length)]; cx = e.pos.x; cz = e.pos.z; }
    else if (this.map.points.length) { const p = this.map.points[Math.floor(rand() * 5)]; cx = p.x; cz = p.z; }
    else { cx = 0; cz = 0; }
    c.center.set(cx, 0, cz);
    c.ang = rand() * 6.28;
    c.radius = this.phase === "dead" ? 5 : 14 + rand() * 22;
    c.height = this.phase === "dead" ? 2.4 : 3 + rand() * 12;
    c.speed = (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.07);
  }

  // ------------------------------------------------------------------ main loop
  start() {
    this.running = true;
    this.lastT = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastT) / 1000);
      this.lastT = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  frame(dtRaw: number) {
    this.dtSmooth = lerp(this.dtSmooth, dtRaw, 0.1);
    this.fpsAcc += dtRaw; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    if (!this.map || this.loading) { return; }
    const dt = this.paused ? 0 : dtRaw;
    if (!this.paused) this.update(dt);
    else { this.updateCamera(0.0001); }
    this.keys.pressed.clear();
    this.render(dtRaw);
    this.hudT -= dtRaw;
    if (this.hudT <= 0) { this.hudT = 1 / 30; this.cb.onHud(this.buildHud()); }
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const p = this.player;
    this.lastMX = this.mouseDX; this.lastMY = this.mouseDY;
    // weather cycle
    let storm = 0;
    this.map.weather.forEach((w, i) => {
      let inten = w.base;
      if (w.cycle > 0) {
        const ph = ((t + 40 + i * 47) % w.cycle) / w.cycle;
        const s = Math.min(1, Math.max(0, (ph - 0.5) / 0.2)) * (1 - Math.min(1, Math.max(0, (ph - 0.85) / 0.15)));
        const ss = s * s * (3 - 2 * s);
        inten = w.base + (1 - w.base) * ss;
        if (w.kind === "rain") storm = Math.max(storm, ss * 0.55);
        else storm = Math.max(storm, ss);
      }
      this.weather[i]?.update(t, this.camera.position, inten);
    });
    this.storm = storm;
    this.visMul = 1 - storm * 0.3;
    const fogD = this.map.fogDensity * (1 + storm * (this.map.id === "jungle" ? 0.8 : 1.6));
    (this.scene.fog as THREE.FogExp2).density = fogD;
    this.fx.setFog(this.map.fogColor, fogD, this.map.particleTint);
    audio.setStorm(storm);
    // player
    if (this.phase === "playing" && p.alive) this.updatePlayer(dt);
    else if (this.phase === "dead") {
      this.respawnIn = Math.max(0, this.respawnIn - dt);
      p.deathT += dt;
    }
    if (p.alive || this.phase === "playing") this.updateWeaponState(p, dt);
    p.hurt = 0;
    // ai
    for (const s of this.soldiers) {
      if (s.isPlayer) continue;
      if (!s.alive) {
        s.deathT += dt;
        s.respawnT -= dt;
        if (s.respawnT <= 0 && !this.ended) {
          if (this.cfg.mode === "conquest" && this.tickets[s.team] <= 0) { s.respawnT = 5; } else if (this.cfg.mode === "assault" && s.team === 0 && this.tickets[0] <= 0) { s.respawnT = 5; } else this.respawn(s);
        }
        continue;
      }
      updateAI(this, s, dt);
      this.updateWeaponState(s, dt);
      s.switchT = Math.max(0, s.switchT - dt);
      // swap to primary after reloading if empty
    }
    // animate models + LOD
    const cp = this.camera.position;
    for (const s of this.soldiers) {
      const m = s.model;
      if (s.isPlayer && !(this.thirdPerson || !s.alive)) { if (s.alive) m.update(dt, this.animFor(s)); continue; }
      const dx = s.pos.x - cp.x, dz = s.pos.z - cp.z;
      const d2 = dx * dx + dz * dz;
      if (!s.alive && s.deathT > 8) { m.root.visible = false; continue; }
      m.root.visible = d2 < 260 * 260 || s.isPlayer;
      if (!m.root.visible) continue;
      m.setLOD(d2 < 55 * 55 ? 0 : d2 < 110 * 110 ? 1 : 2);
      m.root.position.set(s.pos.x, s.pos.y, s.pos.z);
      m.root.rotation.y = s.yaw;
      const steps = m.update(dt, this.animFor(s));
      if (steps && s.alive && !s.isPlayer && d2 < 40 * 40) {
        audio.footstep(s.surface, Math.hypot(s.vel.x, s.vel.z) > 5, { x: s.pos.x, y: s.pos.y, z: s.pos.z });
        if (this.map.snowy && s.surface === "snow" && d2 < 90 * 90) this.fx.footprint(s.pos.x, s.pos.y, s.pos.z, s.yaw);
      }
      s.fireAnim = 0;
      s.hurt = 0;
    }
    if (p.alive && (this.thirdPerson)) { p.model.root.position.set(p.pos.x, p.pos.y, p.pos.z); p.model.root.rotation.y = p.yaw; }
    if (!p.alive) { p.model.root.position.set(p.pos.x, p.pos.y, p.pos.z); p.model.root.rotation.y = p.yaw; }
    else if (!this.thirdPerson) { p.model.root.position.set(p.pos.x, p.pos.y, p.pos.z); p.model.root.rotation.y = p.yaw; }
    this.updateProjectiles(dt);
    this.updateGrenades(dt);
    // pending timers
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].t <= this.time) { const f = this.pending[i].fn; this.pending.splice(i, 1); f(); }
    if (this.phase !== "menu" || true) this.updateMode(dt);
    this.updateEmitters(dt);
    this.updatePointVisuals(dt);
    this.updateAmbient(dt);
    this.fx.update(dt);
    this.map.update(t, dt, this.camera.position);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.explFlash = Math.max(0, this.explFlash - dt * 1.2);
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.2);
    this.suppress = Math.max(0, this.suppress - dt * 0.6);
    this.damageDirs = this.damageDirs.filter((d) => t - d.t < 2.2);
    this.updateCamera(dt);
    audio.updateListener(this.camera.position, this.camera.rotation.y, this.camera.rotation.x);
    audio.tick(dt, this.phase === "menu" ? 1.5 : 1);
  }

  animFor(s: Soldier) {
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const ai = s.ai;
    const aim = s.isPlayer ? 1 : ai && (ai.state === "engage" || ai.state === "cover" || (ai.target && ai.seen < 2)) ? 1 : 0;
    const a = {
      speed, sprint: s.sprint, crouch: s.crouch, aim, pitch: s.pitch, reload: s.w.reload >= 0 ? s.w.reload / s.w.def.reload : -1,
      grounded: s.grounded, vy: s.vel.y, hurt: s.hurt, fire: s.fireAnim, alive: s.alive, deadT: s.deathT, deathType: s.deathType, strafe: s.strafeAmt,
    };
    return a;
  }

  updateEmitters(dt: number) {
    const cp = this.camera.position;
    for (const e of this.map.emitters) {
      const dx = e.x - cp.x, dz = e.z - cp.z;
      if (dx * dx + dz * dz > 170 * 170) continue;
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        switch (e.kind) {
          case "smoke": this.fx.smokePuff(e.x, e.y, e.z, e.scale, 0.08 + rand() * 0.05); break;
          case "fire": this.fx.firePuff(e.x, e.y, e.z, e.scale); break;
          case "flare":
            this.fx.firePuff(e.x, e.y, e.z, e.scale);
            this.fx.add.emit({ x: e.x, y: e.y + 1, z: e.z, vy: 4, life: 0.8, s0: 3 * e.scale, s1: 5 * e.scale, c0: [3, 1.2, 0.3, 0.5], c1: [1, 0.2, 0, 0], tile: 1 });
            break;
          case "steam": this.fx.smoke.emit({ x: e.x, y: e.y, z: e.z, vy: 4 + rand() * 2, vx: 0.8, life: 1.6, s0: 0.5, s1: 2.8 * e.scale, c0: [0.8, 0.8, 0.8, 0.45], c1: [0.8, 0.8, 0.8, 0], drag: 0.6 }); break;
          case "sparks": this.fx.sparkShower(e.x, e.y, e.z, 6); this.fx.flash(e.x, e.y + 0.5, e.z, 1, 0.6, 0.3, 60, 0.12, 12); break;
        }
      }
    }
  }

  updatePointVisuals(dt: number) {
    const t = this.time;
    const cp = this.camera.position;
    for (const p of this.pts) {
      const col = p.owner === 0 ? [0.4, 1.0, 2.8] : p.owner === 1 ? [2.8, 0.35, 0.25] : [1.6, 1.6, 1.6];
      let c = col;
      if (p.contested) { const k = 0.5 + 0.5 * Math.sin(t * 8); c = [2.4, 1.2 + k, 0.3]; }
      const inactive = this.cfg.mode === "assault" && !p.active;
      const ringMat = p.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.setRGB(c[0], c[1], c[2]);
      ringMat.opacity = inactive ? 0.15 : 0.55;
      const bm = (p.beam.material as THREE.ShaderMaterial);
      bm.uniforms.uColor.value.setRGB(c[0] / 2, c[1] / 2, c[2] / 2);
      bm.uniforms.uOp.value = inactive ? 0.06 : 0.32 + 0.05 * Math.sin(t * 2 + p.idx);
      const fm = p.flag.material as THREE.MeshBasicMaterial;
      fm.color.setRGB(c[0], c[1], c[2]);
      // flag height by capture progress
      const frac = p.owner >= 0 ? 1 : Math.abs(p.cap);
      p.flag.position.y = 2.2 + (p.def.letter ? 5.6 * frac : 5.6);
      p.flag.position.y = 2.2 + 5.6 * frac;
      const dxp = p.def.x - cp.x, dzp = p.def.z - cp.z;
      if (dxp * dxp + dzp * dzp < 160 * 160) {
        const pos = p.flagGeo.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) + 1.7;
          pos.setZ(i, Math.sin(x * 2.2 - t * 5 + p.idx) * 0.12 * (x / 3.4));
        }
        pos.needsUpdate = true;
      }
    }
    void dt;
  }

  // ------------------------------------------------------------------ render
  render(dt: number) {
    const m = this.map;
    const cam = this.camera;
    const s = this.settings;
    // shadow frustum follows the camera focus
    if (s.shadows) {
      const R = this.q.shadowRange;
      const texel = (R * 2) / this.q.shadow;
      const f = this.tmpV.copy(cam.position);
      const dir = m.sunDir;
      const right = this.tmpV2.set(-dir.z, 0, dir.x).normalize();
      const up2 = this.tmpV3.crossVectors(dir, right).normalize();
      const a = f.dot(right), b = f.dot(up2);
      f.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up2, Math.round(b / texel) * texel - b);
      this.sun.target.position.copy(f);
      this.sun.position.copy(f).addScaledVector(dir, 180);
      this.sun.target.updateMatrixWorld();
    } else this.sun.position.copy(cam.position).addScaledVector(m.sunDir, 180);
    // dynamic exposure
    const above = this.world.raycast(cam.position.x, cam.position.y, cam.position.z, 0, 1, 0, 7);
    const indoor = above ? 1 : 0;
    const f = cam.getWorldDirection(this.tmpV);
    const sunFacing = Math.max(0, f.x * m.sunDir.x + f.z * m.sunDir.z) / Math.max(0.2, Math.hypot(m.sunDir.x, m.sunDir.z));
    const target = m.exposure * (1 + indoor * 0.38 - sunFacing * 0.1) * (1 - this.explFlash * 0.35);
    this.expo = lerp(this.expo, target, Math.min(1, dt * (target < this.expo ? 8 : 1.6)));
    // motion blur
    const yaw = cam.rotation.y, pitch = cam.rotation.x;
    let dyaw = yaw - this.prevYaw;
    while (dyaw > Math.PI) dyaw -= 6.2832;
    while (dyaw < -Math.PI) dyaw += 6.2832;
    const dpitch = pitch - this.prevPitch;
    this.prevYaw = yaw; this.prevPitch = pitch;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const mbOn = s.motionBlur && !this.paused;
    const bx = mbOn ? clamp((dyaw / hfov) * 0.55, -0.03, 0.03) : 0;
    const by = mbOn ? clamp((-dpitch / vfov) * 0.55, -0.03, 0.03) : 0;
    const blurDir = new THREE.Vector2(bx, by);
    // sun uv
    const sunW = this.tmpV2.copy(cam.position).addScaledVector(m.sunDir, 1000);
    sunW.project(cam);
    const facing = f.dot(m.sunDir);
    this.sunUV.set(sunW.x * 0.5 + 0.5, sunW.y * 0.5 + 0.5, facing > 0 ? clamp(facing * 2, 0, 1) : 0);
    // focus / dof
    let dof = 0;
    if (s.dof) {
      const playing = this.phase === "playing" && this.player.alive;
      if (playing) {
        const h = this.world.raycast(cam.position.x, cam.position.y, cam.position.z, f.x, f.y, f.z, 200);
        const d = h ? h.t : 200;
        this.focus = lerp(this.focus, d, Math.min(1, dt * 6));
        dof = 1.2 + this.player.ads * 5 * (this.scoped ? 0 : 1);
      } else dof = 7;
    }
    const sprintB = this.player.sprint && this.phase === "playing" ? 0.01 : 0;
    const pp: PostParams = {
      exposure: this.expo, tint: m.tint, sat: m.saturation * (1 - this.storm * 0.1), contrast: m.contrast, vignette: m.vignette + this.suppress * 0.3,
      grain: 0.025, time: this.time, blurDir, zoom: sprintB + this.trauma * 0.004, sun: this.sunUV, god: s.godrays ? m.godray * (1 - this.storm * 0.5) : 0,
      focus: Math.max(1.5, this.focus), dof, ssao: s.ssao ? 1 : 0,
      damage: clamp(this.dmgFlash * 0.8 + (this.player.alive && this.phase === "playing" ? Math.max(0, 1 - this.player.hp / this.player.maxHp - 0.5) * 0.9 : 0), 0, 1),
      flash: this.explFlash * 0.12, aber: 0.0016 + this.trauma * 0.004 + this.dmgFlash * 0.004, fade: 1, bloom: s.bloom,
      bloomStrength: m.bloom.strength, bloomThreshold: m.bloom.threshold, bloomRadius: m.bloom.radius, near: cam.near, far: cam.far,
    };
    this.post.render(this.scene, cam, pp, dt);
  }

  // ------------------------------------------------------------------ HUD
  buildHud(): HudState {
    const p = this.player;
    const w = p.w;
    const def = w.def;
    const cam = this.camera;
    const pts = this.pts.map((pt) => {
      const v = this.tmpV.set(pt.def.x, pt.y + 10, pt.def.z).project(cam);
      const behind = v.z > 1;
      return {
        name: pt.def.name || pt.def.letter, owner: pt.owner, cap: pt.cap, x: pt.def.x, z: pt.def.z, active: pt.active,
        screenX: (v.x * 0.5 + 0.5) * 100, screenY: (-v.y * 0.5 + 0.5) * 100,
        onScreen: !behind && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, dist: Math.hypot(pt.def.x - p.pos.x, pt.def.z - p.pos.z),
      };
    });
    const mm: HudState["minimap"] = [];
    for (const s of this.soldiers) {
      if (!s.alive || s.isPlayer) continue;
      if (s.team === p.team || s.spotT > 0 || Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) < 35) mm.push({ x: s.pos.x, z: s.pos.z, team: s.team });
      s.spotT = Math.max(0, s.spotT - 1 / 30);
    }
    const mode = this.cfg.mode;
    let timer = this.matchT;
    if (mode === "tdm") timer = Math.max(0, 600 - this.matchT);
    if (mode === "assault") timer = Math.max(0, 780 - this.matchT);
    const opts = this.spawnOptions(p.team).map((o) => ({ id: o.id, name: o.name }));
    let objective = "";
    if (mode === "assault") {
      const act = this.pts[Math.min(this.stage, this.pts.length - 1)];
      objective = this.player.team === 0 ? `ATTACK — SECURE ${act?.def.name.toUpperCase()}` : `DEFEND — HOLD ${act?.def.name.toUpperCase()}`;
    } else if (mode === "conquest") objective = "CAPTURE AND HOLD POINTS";
    else objective = "ELIMINATE ENEMY FORCES";
    const killer = this.killedBy;
    return {
      running: this.running, alive: p.alive && this.phase === "playing", hp: Math.max(0, p.hp), maxHp: p.maxHp,
      weapon: { name: def.name, ammo: def.energy ? Math.round((1 - w.heat) * 100) : w.ammo, reserve: def.energy ? 0 : w.reserve, mag: def.energy ? 100 : def.mag, heat: w.heat, overheated: w.overheated, energy: def.energy, reloading: w.reload >= 0 ? w.reload / def.reload : 0, slot: p.cur, slots: p.weapons.map((x) => x.def.name) },
      grenades: p.grenades, tickets: [...this.tickets] as [number, number], ticketsMax: this.ticketsMax, timer, points: pts,
      feed: this.feed.filter((f) => this.time - f.t < 7), hitMarker: this.hitMarker, hitKill: this.hitKill, hitHead: this.hitHead,
      damageDirs: this.damageDirs.map((d) => ({ ...d })), yaw: p.yaw, mode, scoped: this.scoped, ads: p.ads > 0.5, crouch: p.crouch, sprint: p.sprint,
      fps: this.fps, kills: p.kills, deaths: p.deaths, score: p.score, message: this.time < this.messageT ? this.message : "", messageT: this.messageT,
      objective, playerTeam: p.team, respawnIn: this.respawnIn, killedBy: killer, ended: this.ended, minimap: mm, px: p.pos.x, pz: p.pos.z,
      worldRadius: 235, thirdPerson: this.thirdPerson, spawnOptions: opts, streak: p.streak, stageText: mode === "assault" ? `STAGE ${Math.min(this.stage + 1, 3)} / 3` : "", paused: this.paused,
      phase: this.phase, spread: this.phase === "playing" ? this.spreadFor(p) : 1, time: this.time, loading: this.loading, mapName: this.map?.name || "", mapSub: this.map?.sub || "",
      suppress: this.suppress, dmgFlash: this.dmgFlash, cls: p.cls,
    } as HudState;
  }

  // ------------------------------------------------------------------ input
  onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    this.keys.down.add(e.code);
    this.keys.pressed.add(e.code);
  };
  onKeyUp = (e: KeyboardEvent) => { this.keys.down.delete(e.code); };
  onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.mouseDown[e.button] = true;
    if (e.button === 0) this.clickEdge = true;
  };
  onMouseUp = (e: MouseEvent) => { this.mouseDown[e.button] = false; };
  onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  onWheel = (e: WheelEvent) => {
    if (this.phase !== "playing" || !this.player.alive || this.paused) return;
    const n = this.player.weapons.length;
    this.switchWeapon(this.player, (this.player.cur + (e.deltaY > 0 ? 1 : -1) + n) % n);
  };
  onBlur = () => { this.keys.down.clear(); this.mouseDown = [false, false, false]; };
  onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked) {
      this.mouseDown = [false, false, false];
      this.keys.down.clear();
      if (this.phase === "playing" && this.player.alive) this.paused = true;
    }
    this.cb.onLock(locked);
  };

  startAudio() {
    audio.init(this.settings);
    audio.startAmbience(this.map.id, this.map.reverb);
    audio.startMusic(this.phase === "menu" ? 0.3 : 0.6);
  }

  async reloadForQuality() {
    this.mapDirty = true;
    await this.startMatch(this.cfg, this.phase !== "menu");
  }

  resume() {
    this.paused = false;
    audio.resume();
    if (this.phase === "playing") this.lockPointer();
  }

  async toMenu() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.paused = false;
    await this.startMatch({ mode: "conquest", map: this.cfg.map, team: 0, cls: "assault" }, false);
    this.phase = "menu";
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.running = false;
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("blur", this.onBlur);
    audio.stopMusic();
    audio.stopAmbience();
    this.renderer.dispose();
  }
}

export { WEAPONS };
export type { WeaponSound };
