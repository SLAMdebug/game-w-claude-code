import * as THREE from "three";
import { makeParticleAtlas, makeScorchTexture, makeFootprintTexture } from "./textures";

const vs = /* glsl */ `
attribute vec3 iPos; attribute vec4 iData; attribute vec4 iColor; attribute vec3 iVel;
varying vec2 vUv; varying vec4 vColor; varying float vFog; varying float vTile;
uniform float uFogD;
void main(){
  vec4 mv = modelViewMatrix * vec4(iPos,1.0);
  float size = iData.x;
  vec2 c = position.xy;
  vec2 off;
  if (iData.w > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel,0.0)).xyz;
    float sp = length(vv.xy);
    vec2 dir = sp > 0.001 ? vv.xy / sp : vec2(0.0,1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    off = (dir * c.y * (1.0 + iData.w * min(sp,45.0) * 0.09) + perp * c.x) * size;
  } else {
    float cs = cos(iData.y), sn = sin(iData.y);
    off = vec2(c.x*cs - c.y*sn, c.x*sn + c.y*cs) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  if (size <= 0.0001) gl_Position = vec4(2.0,2.0,2.0,1.0);
  vUv = position.xy + 0.5;
  vColor = iColor;
  vTile = iData.z;
  float dist = length(mv.xyz);
  vFog = 1.0 - exp(-uFogD*uFogD*dist*dist);
}`;
const fs = /* glsl */ `
uniform sampler2D uTex; uniform vec3 uFogC; uniform vec3 uTint; uniform float uAdd;
varying vec2 vUv; varying vec4 vColor; varying float vFog; varying float vTile;
void main(){
  float t = floor(vTile + 0.5);
  vec2 tile = vec2(mod(t,2.0), floor(t/2.0)) * 0.5;
  vec4 tex = texture2D(uTex, tile + vUv * 0.5);
  float a = tex.a * vColor.a;
  vec3 col = vColor.rgb * tex.rgb;
  if (uAdd > 0.5) { gl_FragColor = vec4(col * (1.0 - vFog), a); }
  else { col *= uTint; col = mix(col, uFogC, vFog * 0.9); gl_FragColor = vec4(col, a); }
}`;

export interface PSpawn {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number; s0: number; s1: number;
  c0: [number, number, number, number];
  c1?: [number, number, number, number];
  drag?: number; grav?: number; tile?: number; stretch?: number; rot?: number; rotV?: number;
}

export class ParticleSystem {
  mesh: THREE.Mesh;
  cap: number;
  head = 0;
  P: Float32Array; V: Float32Array; L: Float32Array; S: Float32Array; C0: Float32Array; C1: Float32Array; M: Float32Array;
  aPos: THREE.InstancedBufferAttribute; aData: THREE.InstancedBufferAttribute; aCol: THREE.InstancedBufferAttribute; aVel: THREE.InstancedBufferAttribute;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, tex: THREE.Texture, cap: number, additive: boolean) {
    this.cap = cap;
    this.P = new Float32Array(cap * 3);
    this.V = new Float32Array(cap * 3);
    this.L = new Float32Array(cap * 2);
    this.S = new Float32Array(cap * 4);
    this.C0 = new Float32Array(cap * 4);
    this.C1 = new Float32Array(cap * 4);
    this.M = new Float32Array(cap * 4);
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPos", this.aPos);
    geo.setAttribute("iData", this.aData);
    geo.setAttribute("iColor", this.aCol);
    geo.setAttribute("iVel", this.aVel);
    geo.instanceCount = cap;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTex: { value: tex },
        uFogD: { value: 0.003 },
        uFogC: { value: new THREE.Color(0.5, 0.5, 0.5) },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uAdd: { value: additive ? 1 : 0 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 10;
    scene.add(this.mesh);
  }
  emit(s: PSpawn) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.P[i * 3] = s.x; this.P[i * 3 + 1] = s.y; this.P[i * 3 + 2] = s.z;
    this.V[i * 3] = s.vx ?? 0; this.V[i * 3 + 1] = s.vy ?? 0; this.V[i * 3 + 2] = s.vz ?? 0;
    this.L[i * 2] = 0; this.L[i * 2 + 1] = s.life;
    this.S[i * 4] = s.s0; this.S[i * 4 + 1] = s.s1; this.S[i * 4 + 2] = s.rot ?? Math.random() * 6.28; this.S[i * 4 + 3] = s.rotV ?? (Math.random() - 0.5) * 1.2;
    const c1 = s.c1 ?? [s.c0[0], s.c0[1], s.c0[2], 0];
    for (let k = 0; k < 4; k++) { this.C0[i * 4 + k] = s.c0[k]; this.C1[i * 4 + k] = c1[k]; }
    this.M[i * 4] = s.drag ?? 0; this.M[i * 4 + 1] = s.grav ?? 0; this.M[i * 4 + 2] = s.tile ?? Math.floor(Math.random() * 3); this.M[i * 4 + 3] = s.stretch ?? 0;
  }
  update(dt: number) {
    const { P, V, L, S, C0, C1, M } = this;
    const pd = this.aPos.array as Float32Array;
    const dd = this.aData.array as Float32Array;
    const cd = this.aCol.array as Float32Array;
    const vd = this.aVel.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      const max = L[i * 2 + 1];
      if (max <= 0) { dd[i * 4] = 0; continue; }
      const age = (L[i * 2] += dt);
      if (age >= max) { L[i * 2 + 1] = 0; dd[i * 4] = 0; continue; }
      const t = age / max;
      const drag = Math.exp(-M[i * 4] * dt);
      V[i * 3] *= drag; V[i * 3 + 1] = V[i * 3 + 1] * drag + M[i * 4 + 1] * dt; V[i * 3 + 2] *= drag;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      S[i * 4 + 2] += S[i * 4 + 3] * dt;
      pd[i * 3] = P[i * 3]; pd[i * 3 + 1] = P[i * 3 + 1]; pd[i * 3 + 2] = P[i * 3 + 2];
      dd[i * 4] = S[i * 4] + (S[i * 4 + 1] - S[i * 4]) * Math.sqrt(t);
      dd[i * 4 + 1] = S[i * 4 + 2];
      dd[i * 4 + 2] = M[i * 4 + 2];
      dd[i * 4 + 3] = M[i * 4 + 3];
      // fade in quickly, lerp colour
      const fi = Math.min(1, t * 12);
      for (let k = 0; k < 3; k++) cd[i * 4 + k] = C0[i * 4 + k] + (C1[i * 4 + k] - C0[i * 4 + k]) * t;
      cd[i * 4 + 3] = (C0[i * 4 + 3] + (C1[i * 4 + 3] - C0[i * 4 + 3]) * t) * fi;
      vd[i * 3] = V[i * 3]; vd[i * 3 + 1] = V[i * 3 + 1]; vd[i * 3 + 2] = V[i * 3 + 2];
    }
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true; this.aCol.needsUpdate = true; this.aVel.needsUpdate = true;
  }
}

// ----- glowing bolts -----
export class BoltPool {
  core: THREE.InstancedMesh;
  halo: THREE.InstancedMesh;
  n = 0;
  cap: number;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private z = new THREE.Vector3(0, 0, 1);
  private d = new THREE.Vector3();
  constructor(scene: THREE.Scene, cap = 220) {
    this.cap = cap;
    const g1 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    g1.rotateX(Math.PI / 2);
    const mk = (r: number, op: number) => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.InstancedMesh(g1, mat, cap);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 13;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      scene.add(mesh);
      void r;
      return mesh;
    };
    this.core = mk(0.03, 1);
    this.halo = mk(0.1, 0.55);
  }
  begin() { this.n = 0; }
  add(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, r: number, g: number, b: number, thick = 1) {
    if (this.n >= this.cap) return;
    this.d.set(dx, dy, dz);
    this.q.setFromUnitVectors(this.z, this.d);
    this.p.set(x, y, z);
    this.s.set(0.028 * thick, 0.028 * thick, len);
    this.m.compose(this.p, this.q, this.s);
    this.core.setMatrixAt(this.n, this.m);
    this.c.setRGB(3, 3, 3);
    this.core.setColorAt(this.n, this.c);
    this.s.set(0.09 * thick, 0.09 * thick, len * 1.15);
    this.m.compose(this.p, this.q, this.s);
    this.halo.setMatrixAt(this.n, this.m);
    this.c.setRGB(r, g, b);
    this.halo.setColorAt(this.n, this.c);
    this.n++;
  }
  end() {
    this.core.count = this.halo.count = this.n;
    this.core.instanceMatrix.needsUpdate = this.halo.instanceMatrix.needsUpdate = true;
    if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
  }
}

// ----- decals -----
export class DecalPool {
  mesh: THREE.InstancedMesh;
  head = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);
  private n = new THREE.Vector3();
  constructor(scene: THREE.Scene, tex: THREE.Texture, public cap: number) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
  }
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, rot = Math.random() * 6.28) {
    this.n.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.z, this.n);
    this.q2.setFromAxisAngle(this.z, rot);
    this.q.multiply(this.q2);
    this.p.set(x + this.n.x * 0.02, y + this.n.y * 0.02, z + this.n.z * 0.02);
    this.s.set(size, size, size);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.head, this.m);
    this.head = (this.head + 1) % this.cap;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ----- debris -----
export class DebrisPool {
  mesh: THREE.InstancedMesh;
  cap: number;
  P: Float32Array; V: Float32Array; R: Float32Array; A: Float32Array; Sz: Float32Array; Lf: Float32Array;
  head = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  ground: (x: number, z: number) => number = () => 0;
  constructor(scene: THREE.Scene, cap = 200) {
    this.cap = cap;
    this.P = new Float32Array(cap * 3); this.V = new Float32Array(cap * 3); this.R = new Float32Array(cap * 3); this.A = new Float32Array(cap * 3);
    this.Sz = new Float32Array(cap); this.Lf = new Float32Array(cap);
    const geo = new THREE.DodecahedronGeometry(0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.3, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(0.4), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, zero);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, r: number, g: number, b: number, life = 5) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.P.set([x, y, z], i * 3); this.V.set([vx, vy, vz], i * 3);
    this.R.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.A.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
    this.Sz[i] = size; this.Lf[i] = life;
    this.c.setRGB(r, g, b);
    this.mesh.setColorAt(i, this.c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.Lf[i] <= 0) continue;
      this.Lf[i] -= dt;
      const i3 = i * 3;
      if (this.Lf[i] <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      const gy = this.ground(this.P[i3], this.P[i3 + 2]) + this.Sz[i] * 0.3;
      const resting = this.P[i3 + 1] <= gy + 0.01 && Math.abs(this.V[i3 + 1]) < 0.5;
      if (!resting) {
        this.V[i3 + 1] -= 16 * dt;
        this.P[i3] += this.V[i3] * dt; this.P[i3 + 1] += this.V[i3 + 1] * dt; this.P[i3 + 2] += this.V[i3 + 2] * dt;
        this.R[i3] += this.A[i3] * dt; this.R[i3 + 1] += this.A[i3 + 1] * dt; this.R[i3 + 2] += this.A[i3 + 2] * dt;
        if (this.P[i3 + 1] < gy) {
          this.P[i3 + 1] = gy;
          this.V[i3 + 1] *= -0.35; this.V[i3] *= 0.6; this.V[i3 + 2] *= 0.6;
          this.A[i3] *= 0.5; this.A[i3 + 1] *= 0.5; this.A[i3 + 2] *= 0.5;
        }
      }
      this.e.set(this.R[i3], this.R[i3 + 1], this.R[i3 + 2]);
      this.q.setFromEuler(this.e);
      this.p.set(this.P[i3], this.P[i3 + 1], this.P[i3 + 2]);
      const sc = this.Sz[i] * Math.min(1, this.Lf[i]);
      this.s.set(sc, sc * 0.7, sc * 0.9);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ----- shock rings & flashes -----
class Shock {
  ring: THREE.Mesh; sphere: THREE.Mesh; t = 99; dur = 0.6; size = 1;
  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.ring.visible = this.sphere.visible = false;
    this.ring.frustumCulled = this.sphere.frustumCulled = false;
    scene.add(this.ring, this.sphere);
  }
}

class FlashLight {
  light: THREE.PointLight; t = 99; dur = 0.3; base = 0;
  constructor(scene: THREE.Scene) {
    this.light = new THREE.PointLight(0xffaa55, 0, 40, 2);
    scene.add(this.light);
  }
}

export class Fx {
  atlas: THREE.Texture;
  smoke: ParticleSystem;
  add: ParticleSystem;
  bolts: BoltPool;
  scorch: DecalPool;
  foot: DecalPool;
  debris: DebrisPool;
  shocks: Shock[] = [];
  lights: FlashLight[] = [];
  dust: [number, number, number] = [0.5, 0.42, 0.32];
  snowy = false;
  quality = 1;
  shake = 0;
  constructor(public scene: THREE.Scene, quality: number) {
    this.quality = quality;
    this.atlas = makeParticleAtlas();
    this.smoke = new ParticleSystem(scene, this.atlas, Math.floor(1800 * quality), false);
    this.add = new ParticleSystem(scene, this.atlas, Math.floor(2400 * quality), true);
    this.bolts = new BoltPool(scene);
    this.scorch = new DecalPool(scene, makeScorchTexture(), 140);
    this.foot = new DecalPool(scene, makeFootprintTexture(), 220);
    this.debris = new DebrisPool(scene, Math.floor(160 * quality));
    for (let i = 0; i < 4; i++) this.shocks.push(new Shock(scene));
    for (let i = 0; i < 5; i++) this.lights.push(new FlashLight(scene));
  }
  setFog(color: THREE.Color, density: number, tint: THREE.Color) {
    for (const s of [this.smoke, this.add]) {
      s.mat.uniforms.uFogD.value = density;
      s.mat.uniforms.uFogC.value.copy(color);
      s.mat.uniforms.uTint.value.copy(tint);
    }
  }
  flash(x: number, y: number, z: number, r: number, g: number, b: number, intensity: number, dur: number, range: number) {
    let best = this.lights[0];
    for (const l of this.lights) { if (l.t >= l.dur) { best = l; break; } if (l.t / l.dur > best.t / best.dur) best = l; }
    best.t = 0; best.dur = dur; best.base = intensity;
    best.light.position.set(x, y, z);
    best.light.color.setRGB(r, g, b);
    best.light.distance = range;
  }
  update(dt: number) {
    this.smoke.update(dt);
    this.add.update(dt);
    this.debris.update(dt);
    for (const l of this.lights) {
      l.t += dt;
      const k = Math.max(0, 1 - l.t / l.dur);
      l.light.intensity = l.base * k * k;
    }
    for (const s of this.shocks) {
      if (s.t >= s.dur) { s.ring.visible = s.sphere.visible = false; continue; }
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = 1 - Math.pow(1 - k, 3);
      s.ring.scale.setScalar(Math.max(0.01, e * 16 * s.size));
      (s.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.6;
      s.sphere.scale.setScalar(Math.max(0.01, (1 - Math.pow(1 - k, 4)) * 5.5 * s.size));
      (s.sphere.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - k, 2.5) * 0.85;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  explosion(x: number, y: number, z: number, size = 1, big = false) {
    const q = this.quality;
    const a = this.add;
    const s = this.smoke;
    const nF = Math.floor(14 * size * q);
    for (let i = 0; i < nF; i++) {
      const r = Math.random() * 1.2 * size;
      const th = Math.random() * 6.28;
      const ph = Math.random() * 3.14;
      a.emit({ x: x + Math.cos(th) * Math.sin(ph) * r, y: y + Math.abs(Math.cos(ph)) * r * 0.6 + 0.4, z: z + Math.sin(th) * Math.sin(ph) * r, vx: Math.cos(th) * (2 + Math.random() * 5) * size, vy: (1 + Math.random() * 5) * size, vz: Math.sin(th) * (2 + Math.random() * 5) * size, life: 0.5 + Math.random() * 0.7, s0: 2.2 * size, s1: (5 + Math.random() * 3) * size, c0: [4, 2.2, 0.7, 1], c1: [0.7, 0.12, 0.02, 0], drag: 2.2 });
    }
    a.emit({ x, y: y + 0.8, z, life: 0.18, s0: 6 * size, s1: 13 * size, c0: [6, 5, 3.5, 1], c1: [3, 1.5, 0.6, 0], tile: 3 });
    for (let i = 0; i < Math.floor(34 * size * q); i++) {
      const th = Math.random() * 6.28;
      const sp = (10 + Math.random() * 28) * Math.sqrt(size);
      const up = 4 + Math.random() * 16;
      a.emit({ x, y: y + 0.4, z, vx: Math.cos(th) * sp, vy: up, vz: Math.sin(th) * sp, life: 0.5 + Math.random() * 1.1, s0: 0.14, s1: 0.04, c0: [5, 2.6, 0.7, 1], c1: [1, 0.15, 0, 0], grav: -17, drag: 0.4, stretch: 1, tile: 3 });
    }
    const nS = Math.floor(16 * size * q);
    for (let i = 0; i < nS; i++) {
      const th = Math.random() * 6.28;
      const r = Math.random() * 2 * size;
      const dark = 0.1 + Math.random() * 0.1;
      s.emit({ x: x + Math.cos(th) * r, y: y + 0.6 + Math.random() * 1.5, z: z + Math.sin(th) * r, vx: Math.cos(th) * Math.random() * 3, vy: (2 + Math.random() * 4) * size * 0.6, vz: Math.sin(th) * Math.random() * 3, life: 3 + Math.random() * 4, s0: 2 * size, s1: (7 + Math.random() * 5) * size, c0: [dark, dark * 0.95, dark * 0.9, 0.85], c1: [0.32, 0.31, 0.3, 0], drag: 0.9, grav: 0.8 });
    }
    const d = this.dust;
    for (let i = 0; i < Math.floor(18 * size * q); i++) {
      const th = (i / 18) * 6.28 + Math.random() * 0.3;
      const sp = 7 + Math.random() * 9;
      s.emit({ x, y: y + 0.3, z, vx: Math.cos(th) * sp * size * 0.7, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(th) * sp * size * 0.7, life: 1.4 + Math.random() * 2, s0: 1.5 * size, s1: (5 + Math.random() * 3) * size, c0: [d[0], d[1], d[2], 0.55], c1: [d[0], d[1], d[2], 0], drag: 2.2, grav: 0.2 });
    }
    for (let i = 0; i < Math.floor(12 * size * q); i++) {
      const th = Math.random() * 6.28;
      const sp = 6 + Math.random() * 14;
      const dc = 0.15 + Math.random() * 0.3;
      this.debris.emit(x, y + 0.5, z, Math.cos(th) * sp, 7 + Math.random() * 12, Math.sin(th) * sp, 0.15 + Math.random() * 0.35, dc * 1.2, dc, dc * 0.9, 5 + Math.random() * 4);
    }
    const sh = this.shocks.find((k) => k.t >= k.dur) || this.shocks[0];
    sh.t = 0; sh.dur = 0.55; sh.size = size;
    sh.ring.position.set(x, y + 0.3, z); sh.sphere.position.set(x, y + 1, z);
    sh.ring.visible = sh.sphere.visible = true;
    this.flash(x, y + 2, z, 1, 0.55, 0.2, 1400 * size, 0.7, 55 * size);
    this.scorch.add(x, y + 0.05, z, 0, 1, 0, 5 * size);
    if (big) {
      for (let i = 0; i < 8; i++) a.emit({ x: x + (Math.random() - 0.5) * 3, y: y + 1 + i * 0.6, z: z + (Math.random() - 0.5) * 3, vy: 6 + Math.random() * 6, life: 1 + Math.random(), s0: 2, s1: 6, c0: [3, 1.2, 0.3, 1], c1: [0.4, 0.05, 0, 0], drag: 1 });
    }
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: string, energy: [number, number, number] | null) {
    const a = this.add;
    const hard = surface === "metal" || surface === "rock" || surface === "concrete" || surface === "ice";
    const n = hard ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const sp = 3 + Math.random() * 9;
      a.emit({ x, y, z, vx: nx * sp + (Math.random() - 0.5) * 6, vy: ny * sp + (Math.random() - 0.5) * 6 + 1, vz: nz * sp + (Math.random() - 0.5) * 6, life: 0.25 + Math.random() * 0.4, s0: 0.1, s1: 0.03, c0: energy ? [energy[0], energy[1], energy[2], 1] : [5, 2.4, 0.6, 1], c1: [1, 0.1, 0, 0], grav: -12, stretch: 1, tile: 3 });
    }
    a.emit({ x, y, z, life: 0.1, s0: 0.5, s1: 0.9, c0: energy ? [energy[0] * 1.5, energy[1] * 1.5, energy[2] * 1.5, 1] : [4, 3, 1.5, 1], c1: [1, 0.5, 0.2, 0], tile: 3 });
    const d = surface === "snow" || surface === "ice" ? [0.85, 0.9, 0.97] : surface === "mud" || surface === "grass" ? [0.22, 0.17, 0.12] : surface === "metal" ? [0.3, 0.3, 0.3] : this.dust;
    const k = surface === "sand" || surface === "snow" || surface === "mud" ? 4 : 2;
    for (let i = 0; i < k; i++)
      this.smoke.emit({ x, y, z, vx: nx * 1.5 + (Math.random() - 0.5), vy: ny * 1.5 + 0.7 + Math.random() * 0.5, vz: nz * 1.5 + (Math.random() - 0.5), life: 0.7 + Math.random() * 0.8, s0: 0.25, s1: 0.9 + Math.random() * 0.4, c0: [d[0], d[1], d[2], 0.5], c1: [d[0], d[1], d[2], 0], drag: 2.5, grav: -0.3 });
    if (surface !== "water") this.scorch.add(x, y, z, nx, ny, nz, 0.35 + Math.random() * 0.15);
    if (hard && Math.random() < 0.5) this.debris.emit(x, y, z, nx * 3 + (Math.random() - 0.5) * 3, ny * 3 + 2, nz * 3 + (Math.random() - 0.5) * 3, 0.06 + Math.random() * 0.06, 0.4, 0.38, 0.35, 2);
  }

  blood(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: [number, number, number]) {
    for (let i = 0; i < 6; i++) {
      this.add.emit({ x, y, z, vx: nx * 4 + (Math.random() - 0.5) * 4, vy: ny * 4 + Math.random() * 3, vz: nz * 4 + (Math.random() - 0.5) * 4, life: 0.3 + Math.random() * 0.3, s0: 0.08, s1: 0.03, c0: [col[0] * 3, col[1] * 3, col[2] * 3, 1], c1: [col[0], col[1], col[2], 0], grav: -10, stretch: 1, tile: 3 });
    }
  }

  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, size: number, col: [number, number, number], light = true) {
    const a = this.add;
    a.emit({ x: x + dx * 0.15, y: y + dy * 0.15, z: z + dz * 0.15, life: 0.05, s0: size * 0.9, s1: size * 1.5, c0: [col[0] * 2.5, col[1] * 2.5, col[2] * 2.5, 1], c1: [col[0], col[1], col[2], 0], tile: 3 });
    a.emit({ x: x + dx * 0.4, y: y + dy * 0.4, z: z + dz * 0.4, vx: dx * 12, vy: dy * 12, vz: dz * 12, life: 0.06, s0: size * 0.5, s1: size * 0.3, c0: [3, 3, 3, 1], c1: [col[0], col[1], col[2], 0], tile: 3, stretch: 1.5 });
    if (light) this.flash(x + dx * 0.6, y + dy * 0.6, z + dz * 0.6, col[0] * 0.5 + 0.5, col[1] * 0.5 + 0.4, col[2] * 0.4 + 0.3, 90 * size, 0.07, 14);
  }

  smokePuff(x: number, y: number, z: number, scale = 1, dark = 0.12) {
    const w = (Math.random() - 0.5) * 0.7;
    this.smoke.emit({ x: x + (Math.random() - 0.5), y, z: z + (Math.random() - 0.5), vx: 1.2 + w, vy: 2.6 + Math.random() * 1.5, vz: 0.5 + w, life: 6 + Math.random() * 4, s0: 1.2 * scale, s1: (6 + Math.random() * 3) * scale, c0: [dark, dark, dark * 0.95, 0.6], c1: [0.3, 0.3, 0.3, 0], drag: 0.35, grav: 0.1 });
  }
  firePuff(x: number, y: number, z: number, scale = 1) {
    this.add.emit({ x: x + (Math.random() - 0.5) * scale, y, z: z + (Math.random() - 0.5) * scale, vy: 1.5 + Math.random() * 2, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, life: 0.6 + Math.random() * 0.5, s0: 1.1 * scale, s1: 0.25 * scale, c0: [3, 1.3, 0.3, 0.9], c1: [0.8, 0.1, 0, 0], drag: 0.5 });
  }
  sparkShower(x: number, y: number, z: number, n = 8) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * 6.28;
      const sp = 2 + Math.random() * 5;
      this.add.emit({ x, y, z, vx: Math.cos(th) * sp, vy: 2 + Math.random() * 4, vz: Math.sin(th) * sp, life: 0.6 + Math.random() * 0.8, s0: 0.1, s1: 0.03, c0: [4, 2, 0.5, 1], c1: [1, 0.2, 0, 0], grav: -14, stretch: 1, tile: 3 });
    }
  }
  footprint(x: number, y: number, z: number, yaw: number) {
    this.foot.add(x, y, z, 0, 1, 0, 0.45, -yaw);
  }
}

// ----- weather particles (stateless GPU) -----
export type WeatherKind = "snow" | "dust" | "embers" | "spores" | "rain";

export class Weather {
  obj: THREE.Object3D;
  mat: THREE.ShaderMaterial;
  kind: WeatherKind;
  constructor(scene: THREE.Scene, kind: WeatherKind, count: number, box: number) {
    this.kind = kind;
    const rnd = new Float32Array(count * 3);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    const isRain = kind === "rain";
    let geo = new THREE.BufferGeometry();
    if (isRain) {
      const seeds = new Float32Array(count * 6);
      const ends = new Float32Array(count * 2);
      const pos = new Float32Array(count * 6);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 2; k++) {
          seeds.set([rnd[i * 3], rnd[i * 3 + 1], rnd[i * 3 + 2]], (i * 2 + k) * 3);
          ends[i * 2 + k] = k;
        }
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
      geo.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    } else {
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(rnd, 3));
      geo.setAttribute("aEnd", new THREE.BufferAttribute(new Float32Array(count), 1));
    }
    const cfg: Record<WeatherKind, { vel: [number, number, number]; size: number; col: [number, number, number]; op: number }> = {
      snow: { vel: [-9, -4.5, -3], size: 70, col: [1, 1, 1.05], op: 0.9 },
      dust: { vel: [-22, -0.3, -6], size: 160, col: [0.75, 0.6, 0.42], op: 0.28 },
      embers: { vel: [1.5, 1.8, 0.8], size: 38, col: [3, 1.2, 0.3], op: 1 },
      spores: { vel: [0.25, 0.1, 0.18], size: 36, col: [1.6, 2.4, 0.8], op: 0.8 },
      rain: { vel: [-4, -38, -2], size: 1, col: [0.7, 0.8, 0.95], op: 0.35 },
    };
    const c = cfg[kind];
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: kind === "embers" || kind === "spores" ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(box, box * 0.6, box) },
        uVel: { value: new THREE.Vector3(...c.vel) },
        uSize: { value: c.size },
        uColor: { value: new THREE.Color(...c.col) },
        uOpacity: { value: c.op },
        uIntensity: { value: 1 },
        uRain: { value: isRain ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed; attribute float aEnd;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel; uniform float uSize; uniform float uRain; uniform float uIntensity;
        varying float vA;
        void main(){
          vec3 p = aSeed * uBox + uVel * uTime * (0.7 + aSeed.x * 0.6);
          p.x += sin(uTime * 0.7 + aSeed.y * 40.0) * 0.8 * (1.0 - uRain);
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 wp = p + uCam;
          if (uRain > 0.5) wp -= normalize(uVel) * 1.4 * aEnd;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = uSize / max(d, 0.5);
          vA = smoothstep(uBox.x * 0.5, uBox.x * 0.25, length(p.xz)) * step(aSeed.z, uIntensity);
          if (uRain > 0.5) vA *= (1.0 - aEnd * 0.8);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uRain; varying float vA;
        void main(){
          float a = 1.0;
          if (uRain < 0.5) { vec2 c = gl_PointCoord - 0.5; a = smoothstep(0.5, 0.0, length(c)); }
          gl_FragColor = vec4(uColor, a * uOpacity * vA);
        }`,
    });
    this.obj = isRain ? new THREE.LineSegments(geo, this.mat) : new THREE.Points(geo, this.mat);
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 11;
    scene.add(this.obj);
    geo = geo; // keep ref
  }
  update(t: number, cam: THREE.Vector3, intensity: number) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uCam.value.copy(cam);
    this.mat.uniforms.uIntensity.value = intensity;
    this.obj.visible = intensity > 0.01;
  }
}
