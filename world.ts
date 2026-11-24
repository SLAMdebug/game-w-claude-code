import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Surface } from "./types";

export interface Collider {
  type: 0 | 1; // 0 box, 1 cylinder
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  cx: number; cz: number; r: number;
  surface: Surface;
  walk: boolean;
  active: boolean;
  tag?: string;
  idx: number;
}

export interface RayHit {
  t: number;
  nx: number; ny: number; nz: number;
  surface: Surface;
  collider: Collider | null;
}

const CELL = 12;
const key = (ix: number, iz: number) => (ix + 1024) * 4096 + (iz + 1024);

export class World {
  colliders: Collider[] = [];
  grid = new Map<number, Collider[]>();
  half: number;
  res = 1;
  n: number;
  hgrid: Float32Array;
  surfaceFn: (x: number, z: number) => Surface = () => "sand";
  radius: number;
  lastSurface: Surface = "sand";
  stamp = 0;
  private marks = new Map<Collider, number>();
  constructor(half: number, radius: number, heightFn: (x: number, z: number) => number, res = 1) {
    this.half = half;
    this.radius = radius;
    this.res = res;
    this.n = Math.round((half * 2) / res) + 1;
    this.hgrid = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.hgrid[j * this.n + i] = heightFn(-half + i * res, -half + j * res);
  }
  heightAt(x: number, z: number) {
    const fx = (x + this.half) / this.res;
    const fz = (z + this.half) / this.res;
    const n = this.n;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i < 0) i = 0; else if (i > n - 2) i = n - 2;
    if (j < 0) j = 0; else if (j > n - 2) j = n - 2;
    const tx = Math.min(1, Math.max(0, fx - i));
    const tz = Math.min(1, Math.max(0, fz - j));
    const h = this.hgrid;
    const a = h[j * n + i] + (h[j * n + i + 1] - h[j * n + i]) * tx;
    const b = h[(j + 1) * n + i] + (h[(j + 1) * n + i + 1] - h[(j + 1) * n + i]) * tx;
    return a + (b - a) * tz;
  }
  add(c: Omit<Collider, "idx" | "active">) {
    const col = c as Collider;
    col.active = true;
    col.idx = this.colliders.length;
    this.colliders.push(col);
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let a = this.grid.get(k);
        if (!a) { a = []; this.grid.set(k, a); }
        a.push(col);
      }
    return col;
  }
  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, surface: Surface = "concrete", walk = true, tag?: string) {
    return this.add({ type: 0, minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, cx, cz, r: 0, surface, walk, tag });
  }
  addCyl(cx: number, cz: number, r: number, y0: number, y1: number, surface: Surface = "rock", walk = false, tag?: string) {
    return this.add({ type: 1, minX: cx - r, maxX: cx + r, minY: y0, maxY: y1, minZ: cz - r, maxZ: cz + r, cx, cz, r, surface, walk, tag });
  }
  /** iterate colliders overlapping an XZ rectangle (deduped) */
  each(x0: number, z0: number, x1: number, z1: number, cb: (c: Collider) => void) {
    this.stamp++;
    const s = this.stamp;
    const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL), iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const a = this.grid.get(key(ix, iz));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const c = a[k];
          if (!c.active) continue;
          if (this.marks.get(c) === s) continue;
          this.marks.set(c, s);
          cb(c);
        }
      }
  }
  /** ground height at (x,z) reachable from feet y with step tolerance */
  groundAt(x: number, z: number, feetY: number, stepUp = 0.6): number {
    let best = this.heightAt(x, z);
    this.lastSurface = this.surfaceFn(x, z);
    this.each(x - 0.3, z - 0.3, x + 0.3, z + 0.3, (c) => {
      if (!c.walk || c.maxY > feetY + stepUp || c.maxY <= best) return;
      if (c.type === 0) {
        if (x < c.minX - 0.1 || x > c.maxX + 0.1 || z < c.minZ - 0.1 || z > c.maxZ + 0.1) return;
      } else {
        const dx = x - c.cx, dz = z - c.cz;
        if (dx * dx + dz * dz > c.r * c.r) return;
      }
      best = c.maxY;
      this.lastSurface = c.surface;
    });
    return best;
  }
  /** push circle out of colliders. returns true if collided */
  collide(p: { x: number; y: number; z: number }, r: number, h: number, step = 0.55): boolean {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      this.each(p.x - r, p.z - r, p.x + r, p.z + r, (c) => {
        if (c.maxY <= p.y + step || c.minY >= p.y + h) return;
        if (c.type === 0) {
          const nx = Math.min(c.maxX, Math.max(c.minX, p.x));
          const nz = Math.min(c.maxZ, Math.max(c.minZ, p.z));
          const dx = p.x - nx, dz = p.z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          hit = true;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d);
            p.z += (dz / d) * (r - d);
          } else {
            const l = p.x - c.minX, rr = c.maxX - p.x, t = p.z - c.minZ, b = c.maxZ - p.z;
            const m = Math.min(l, rr, t, b);
            if (m === l) p.x = c.minX - r;
            else if (m === rr) p.x = c.maxX + r;
            else if (m === t) p.z = c.minZ - r;
            else p.z = c.maxZ + r;
          }
        } else {
          const dx = p.x - c.cx, dz = p.z - c.cz;
          const d2 = dx * dx + dz * dz;
          const rr = c.r + r;
          if (d2 >= rr * rr) return;
          hit = true;
          const d = Math.sqrt(d2) || 0.0001;
          p.x = c.cx + (dx / d) * rr;
          p.z = c.cz + (dz / d) * rr;
        }
      });
    }
    const d = Math.hypot(p.x, p.z);
    if (d > this.radius) {
      p.x *= this.radius / d;
      p.z *= this.radius / d;
      hit = true;
    }
    return hit;
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD: number): RayHit | null {
    let best: RayHit | null = null;
    let bt = maxD;
    // grid DDA
    const ex = ox + dx * maxD, ez = oz + dz * maxD;
    this.stamp++;
    const s = this.stamp;
    let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
    const eix = Math.floor(ex / CELL), eiz = Math.floor(ez / CELL);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : 1e9;
    const tdz = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : 1e9;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx)) : 1e9;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz)) : 1e9;
    let guard = 0;
    while (guard++ < 80) {
      const a = this.grid.get(key(ix, iz));
      if (a) {
        for (let k = 0; k < a.length; k++) {
          const c = a[k];
          if (!c.active || this.marks.get(c) === s) continue;
          this.marks.set(c, s);
          const h = c.type === 0 ? rayBox(c, ox, oy, oz, dx, dy, dz) : rayCyl(c, ox, oy, oz, dx, dy, dz);
          if (h && h.t < bt && h.t >= 0) {
            bt = h.t;
            best = { t: h.t, nx: h.nx, ny: h.ny, nz: h.nz, surface: c.surface, collider: c };
          }
        }
      }
      if ((ix === eix && iz === eiz) || Math.min(tmx, tmz) > bt) break;
      if (tmx < tmz) { tmx += tdx; ix += sx; } else { tmz += tdz; iz += sz; }
    }
    // terrain
    const lim = Math.min(bt, maxD);
    if (dy < 0.999 || oy < 40) {
      let t0 = 0;
      let prevAbove = oy > this.heightAt(ox, oz);
      if (!prevAbove) {
        // started below terrain: ignore terrain
      } else {
        const stepL = lim > 120 ? 2.5 : 1.2;
        for (let t = stepL; t <= lim + stepL; t += stepL) {
          const tt = Math.min(t, lim);
          const y = oy + dy * tt;
          const gh = this.heightAt(ox + dx * tt, oz + dz * tt);
          if (y < gh) {
            let a = t0, b = tt;
            for (let i = 0; i < 7; i++) {
              const m = (a + b) / 2;
              if (oy + dy * m < this.heightAt(ox + dx * m, oz + dz * m)) b = m; else a = m;
            }
            const px = ox + dx * b, pz = oz + dz * b;
            const e = 0.6;
            const gx = this.heightAt(px - e, pz) - this.heightAt(px + e, pz);
            const gz = this.heightAt(px, pz - e) - this.heightAt(px, pz + e);
            const l = Math.hypot(gx, 2 * e, gz);
            if (b < bt) {
              bt = b;
              best = { t: b, nx: gx / l, ny: (2 * e) / l, nz: gz / l, surface: this.surfaceFn(px, pz), collider: null };
            }
            break;
          }
          t0 = tt;
          if (tt >= lim) break;
        }
      }
    }
    return best;
  }
  /** is the path between two points clear of world geometry */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.2);
  }
}

function rayBox(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  let tmin = 0, tmax = 1e9;
  let nx = 0, ny = 0, nz = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [c.minX, c.minY, c.minZ], mx = [c.maxX, c.maxY, c.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null;
    } else {
      let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
      let sgn = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sgn = 1; }
      if (t1 > tmin) { tmin = t1; nx = ny = nz = 0; if (a === 0) nx = sgn; else if (a === 1) ny = sgn; else nz = sgn; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return { t: tmin, nx, ny, nz };
}

function rayCyl(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  const px = ox - c.cx, pz = oz - c.cz;
  const a = dx * dx + dz * dz;
  let best: { t: number; nx: number; ny: number; nz: number } | null = null;
  if (a > 1e-9) {
    const b = 2 * (px * dx + pz * dz);
    const cc = px * px + pz * pz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t = (-b - sq) / (2 * a);
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= c.minY && y <= c.maxY) {
          const hx = px + dx * t, hz = pz + dz * t;
          best = { t, nx: hx / c.r, ny: 0, nz: hz / c.r };
        }
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const [py, ny] of [[c.maxY, 1], [c.minY, -1]]) {
      const t = (py - oy) / dy;
      if (t >= 0 && (!best || t < best.t) && dy * ny < 0) {
        const hx = px + dx * t, hz = pz + dz * t;
        if (hx * hx + hz * hz <= c.r * c.r) best = { t, nx: 0, ny, nz: 0 };
      }
    }
  }
  return best;
}

// ------------ noise helpers -------------
function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}
export function noise2(x: number, z: number) { return noise3(x, 0.37, z); }
export function fbm2(x: number, z: number, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, 0.37 + i * 3.1, z * f); f *= 2; a *= 0.5; }
  return s;
}
export function ridge2(x: number, z: number, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise3(x * f, 1.7 + i * 2.3, z * f) * 2 - 1)); f *= 2; a *= 0.5; }
  return s;
}

// ------------ batching -------------
export class Batcher {
  buckets = new Map<string, { mat: string; geos: THREE.BufferGeometry[] }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(public group: THREE.Group, public mats: Record<string, THREE.Material>, public cell = 70, public noShadow: Set<string> = new Set()) {}
  addGeo(geo: THREE.BufferGeometry, mat: string, cx: number, cz: number) {
    let g = geo;
    if (!g.index) {
      g.deleteAttribute("uv");
      g.deleteAttribute("normal");
      g = mergeVertices(g, 1e-4);
      g.computeVertexNormals();
      this.planarUV(g);
    }
    const k = `${mat}|${Math.floor(cx / this.cell)}|${Math.floor(cz / this.cell)}`;
    let b = this.buckets.get(k);
    if (!b) { b = { mat, geos: [] }; this.buckets.set(k, b); }
    b.geos.push(g);
  }
  planarUV(g: THREE.BufferGeometry, scale = 0.25) {
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      if (ay >= ax && ay >= az) { uv[i * 2] = pos.getX(i) * scale; uv[i * 2 + 1] = pos.getZ(i) * scale; }
      else if (ax >= az) { uv[i * 2] = pos.getZ(i) * scale; uv[i * 2 + 1] = pos.getY(i) * scale; }
      else { uv[i * 2] = pos.getX(i) * scale; uv[i * 2 + 1] = pos.getY(i) * scale; }
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
  /** transform geometry (generic) */
  place(geo: THREE.BufferGeometry, mat: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, uvScale?: number) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    const g = geo.clone();
    if (uvScale && g.index) {
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
    }
    g.applyMatrix4(this.m);
    this.addGeo(g, mat, x, z);
  }
  /** box with world-scaled UVs. cy = centre */
  box(mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, tile = 4, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      const f = Math.floor(i / 4);
      let a = sx, b = sy;
      if (f < 2) { a = sz; b = sy; } else if (f < 4) { a = sx; b = sz; } else { a = sx; b = sy; }
      uv.setXY(i, (uv.getX(i) * a) / tile, (uv.getY(i) * b) / tile);
    }
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.p.set(cx, cy, cz);
    this.s.set(1, 1, 1);
    this.m.compose(this.p, this.q, this.s);
    g.applyMatrix4(this.m);
    this.addGeo(g, mat, cx, cz);
  }
  cyl(mat: string, cx: number, cy: number, cz: number, rTop: number, rBot: number, h: number, seg = 12, tile = 4, rx = 0, rz = 0, ry = 0, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    const uv = g.getAttribute("uv");
    const circ = Math.PI * 2 * Math.max(rTop, rBot);
    const sideCount = (seg + 1) * 2;
    for (let i = 0; i < uv.count; i++) {
      if (i < sideCount) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
      else uv.setXY(i, (uv.getX(i) * Math.max(rTop, rBot) * 2) / tile, (uv.getY(i) * Math.max(rTop, rBot) * 2) / tile);
    }
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.p.set(cx, cy, cz);
    this.s.set(1, 1, 1);
    this.m.compose(this.p, this.q, this.s);
    g.applyMatrix4(this.m);
    this.addGeo(g, mat, cx, cz);
  }
  sphere(mat: string, cx: number, cy: number, cz: number, r: number, sy = 1, tile = 4) {
    const g = new THREE.SphereGeometry(r, 20, 14);
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * r * 6) / tile, (uv.getY(i) * r * 3) / tile);
    this.m.compose(this.p.set(cx, cy, cz), this.q.identity(), this.s.set(1, sy, 1));
    g.applyMatrix4(this.m);
    this.addGeo(g, mat, cx, cz);
  }
  /** cross-quad foliage card */
  card(mat: string, cx: number, cy: number, cz: number, w: number, h: number, ry: number, tilt = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    const g2 = g.clone();
    g2.rotateY(Math.PI / 2);
    const mg = mergeGeometries([g, g2])!;
    const nrm = mg.getAttribute("normal");
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    this.e.set(tilt, ry, 0, "YXZ");
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(cx, cy, cz), this.q, this.s.set(1, 1, 1));
    mg.applyMatrix4(this.m);
    this.addGeo(mg, mat, cx, cz);
  }
  rock(mat: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number, detail = 2, rough = 0.35) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
    const g2 = mergeVertices(g, 1e-4);
    const pos = g2.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const n = noise3(vx * 1.7 + seed, vy * 1.7 + seed * 0.3, vz * 1.7) * 0.7 + noise3(vx * 4 + seed, vy * 4, vz * 4 + seed) * 0.3;
      const k = 1 + (n - 0.5) * 2 * rough;
      pos.setXYZ(i, vx * k * rx, vy * k * ry, vz * k * rz);
    }
    g2.computeVertexNormals();
    g2.translate(x, y, z);
    this.planarUV(g2, 0.18);
    const k = `${mat}|${Math.floor(x / this.cell)}|${Math.floor(z / this.cell)}`;
    let b = this.buckets.get(k);
    if (!b) { b = { mat, geos: [] }; this.buckets.set(k, b); }
    b.geos.push(g2);
  }
  flush() {
    for (const [, b] of this.buckets) {
      if (!b.geos.length) continue;
      const mat = this.mats[b.mat];
      if (!mat) throw new Error("missing material " + b.mat);
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      const ns = this.noShadow.has(b.mat);
      mesh.castShadow = !ns;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      for (const g of b.geos) g.dispose();
    }
    this.buckets.clear();
  }
}

// ------------ terrain -------------
export interface TerrainOpts {
  size: number;
  seg: number;
  tile: number;
  mat1: { map: THREE.Texture; normalMap: THREE.Texture; orm: THREE.Texture };
  mat2: THREE.Texture;
  blend: (x: number, z: number, h: number, slope: number) => number;
  tint: (x: number, z: number, h: number, slope: number) => [number, number, number];
  normalScale?: number;
  envIntensity?: number;
}

export function buildTerrain(world: World, o: TerrainOpts) {
  const geo = new THREE.PlaneGeometry(o.size, o.size, o.seg, o.seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const blend = new Float32Array(n);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = world.heightAt(x, z);
    pos.setY(i, h);
    uv[i * 2] = x / o.tile;
    uv[i * 2 + 1] = -z / o.tile;
  }
  geo.computeVertexNormals();
  const nor = geo.getAttribute("normal");
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const slope = 1 - nor.getY(i);
    blend[i] = Math.min(1, Math.max(0, o.blend(x, z, h, slope)));
    const c = o.tint(x, z, h, slope);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("aBlend", new THREE.BufferAttribute(blend, 1));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({
    map: o.mat1.map, normalMap: o.mat1.normalMap, roughnessMap: o.mat1.orm, metalnessMap: o.mat1.orm,
    roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: o.envIntensity ?? 1,
  });
  mat.normalScale.setScalar(o.normalScale ?? 1);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.map2 = { value: o.mat2 };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aBlend;\nvarying float vBlend;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBlend = aBlend;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D map2;\nvarying float vBlend;")
      .replace(
        "#include <map_fragment>",
        `vec4 s1 = texture2D(map, vMapUv);
         vec4 s2 = texture2D(map2, vMapUv * 0.43 + 0.17);
         vec4 s3 = texture2D(map, vMapUv * 0.131);
         diffuseColor *= mix(s1, s2, vBlend) * (0.75 + s3.r * 0.5);`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

// ------------ sky -------------
export interface SkyOpts {
  zenith: THREE.Color; horizon: THREE.Color; ground: THREE.Color;
  sunDir: THREE.Vector3; sunColor: THREE.Color; sunDisc: number;
  cloudCover: number; cloudLit: THREE.Color; cloudDark: THREE.Color; cloudSpeed: number;
  bodyDir?: THREE.Vector3; bodySize?: number; bodyColor?: THREE.Color; body2Dir?: THREE.Vector3; body2Size?: number; body2Color?: THREE.Color;
  haze?: number;
}

export function makeSky(o: SkyOpts) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uZenith: { value: o.zenith }, uHorizon: { value: o.horizon }, uGround: { value: o.ground },
      uSunDir: { value: o.sunDir.clone().normalize() }, uSunColor: { value: o.sunColor }, uSunDisc: { value: o.sunDisc },
      uCover: { value: o.cloudCover }, uCloudLit: { value: o.cloudLit }, uCloudDark: { value: o.cloudDark }, uTime: { value: 0 }, uSpeed: { value: o.cloudSpeed },
      uBody: { value: new THREE.Vector4(...(o.bodyDir ? o.bodyDir.clone().normalize().toArray() : [0, -1, 0]), o.bodySize ?? 0) },
      uBodyCol: { value: o.bodyColor ?? new THREE.Color(1, 1, 1) },
      uBody2: { value: new THREE.Vector4(...(o.body2Dir ? o.body2Dir.clone().normalize().toArray() : [0, -1, 0]), o.body2Size ?? 0) },
      uBody2Col: { value: o.body2Color ?? new THREE.Color(1, 1, 1) },
      uHaze: { value: o.haze ?? 0.25 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCloudLit, uCloudDark, uBodyCol, uBody2Col;
      uniform float uSunDisc, uCover, uTime, uSpeed, uHaze; uniform vec4 uBody, uBody2;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }
      vec3 body(vec3 d, vec4 b, vec3 col, vec3 sun){
        if (b.w <= 0.0) return vec3(0.0);
        vec3 bd = normalize(b.xyz);
        float c = dot(d, bd);
        float ang = acos(clamp(c, -1.0, 1.0));
        if (ang > b.w) return vec3(0.0);
        vec3 right = normalize(cross(vec3(0.0,1.0,0.0), bd));
        vec3 up = cross(bd, right);
        vec2 p = vec2(dot(d, right), dot(d, up)) / sin(b.w);
        float z = sqrt(max(0.0, 1.0 - dot(p,p)));
        vec3 n = right * p.x + up * p.y + bd * z;
        float lit = smoothstep(-0.25, 0.7, dot(n, sun));
        float tex = 0.55 + 0.6 * fbm(n.xy * 5.0 + n.z * 3.0);
        float edge = smoothstep(1.0, 0.94, length(p));
        return col * tex * (0.04 + lit) * edge * 1.6;
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.18, h));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 6.0) * 0.14 + pow(sd, 50.0) * 0.5 + pow(sd, 400.0) * 2.0);
        col += uSunColor * uSunDisc * smoothstep(0.9993, 0.9998, sd) * 18.0;
        // planets (drawn behind clouds)
        vec3 b1 = body(d, uBody, uBodyCol, uSunDir);
        vec3 b2 = body(d, uBody2, uBody2Col, uSunDir);
        col = col + b1 + b2;
        if (h > 0.0 && uCover > 0.0) {
          vec2 uv = d.xz / (h + 0.18) * 1.1 + vec2(uTime * uSpeed, uTime * uSpeed * 0.3);
          float f = fbm(uv);
          float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, f) * smoothstep(0.0, 0.12, h);
          float lit = pow(sd, 3.0) * 0.8 + 0.3;
          vec3 cc = mix(uCloudDark, uCloudLit, clamp(lit + (f - 0.5) * 0.4, 0.0, 1.0));
          col = mix(col, cc, dens * 0.92);
        }
        col = mix(col, uHorizon, exp(-abs(h) * 14.0) * uHaze);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
