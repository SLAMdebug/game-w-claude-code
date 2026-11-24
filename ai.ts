import * as THREE from "three";
import type { Game } from "./engine";
import type { Soldier } from "./entities";

const rand = Math.random;
const _v = new THREE.Vector3();

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnTo(s: Soldier, yaw: number, rate: number, dt: number) {
  const d = angleDiff(s.yaw, yaw);
  const m = rate * dt;
  s.yaw += Math.abs(d) < m ? d : Math.sign(d) * m;
}

function findCover(g: Game, s: Soldier, tx: number, tz: number): THREE.Vector3 | null {
  const cover = g.map.cover;
  let best: number = -1;
  let bestD = 1e9;
  const n = cover.length;
  if (!n) return null;
  let tests = 0;
  const start = Math.floor(rand() * n);
  for (let k = 0; k < n && tests < 12; k++) {
    const c = cover[(start + k) % n];
    const dx = c.x - s.pos.x, dz = c.z - s.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 26 * 26 || d2 > bestD) continue;
    const tdx = c.x - tx, tdz = c.z - tz;
    if (tdx * tdx + tdz * tdz < 8 * 8) continue;
    tests++;
    if (!g.world.los(tx, 1.6, tz, c.x, 1.0, c.z)) {
      best = (start + k) % n;
      bestD = d2;
    }
  }
  if (best < 0) return null;
  const c = cover[best];
  return _v.set(c.x, g.world.heightAt(c.x, c.z), c.z).clone();
}

function perceive(g: Game, s: Soldier) {
  const ai = s.ai!;
  if (ai.target && !ai.target.alive) ai.target = null;
  const def = s.w.def;
  const vis = g.visMul;
  const range = Math.max(55, def.aiRange * 1.3) * vis;
  const r2 = range * range;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  let best: Soldier | null = null;
  let tests = 0;
  const cands: { e: Soldier; d: number }[] = [];
  for (const e of g.soldiers) {
    if (!e.alive || e.team === s.team) continue;
    const dx = e.pos.x - s.pos.x, dz = e.pos.z - s.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    if (d > 14 && ai.alertT <= 0) {
      const dot = (dx * fx + dz * fz) / d;
      if (dot < -0.2) continue;
    }
    cands.push({ e, d });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    if (tests++ >= 3) break;
    const e = c.e;
    const crouchOff = e.crouch ? 0.5 : 0;
    if (g.world.los(s.pos.x, s.eyeY, s.pos.z, e.pos.x, e.pos.y + 1.35 - crouchOff, e.pos.z) || g.world.los(s.pos.x, s.eyeY, s.pos.z, e.pos.x, e.headY, e.pos.z)) {
      best = e;
      break;
    }
  }
  if (best) {
    if (ai.target !== best) {
      ai.target = best;
      ai.react = (0.25 + rand() * 0.5) / ai.skill;
    }
    ai.seen = 0;
    ai.lastKnown.copy(best.pos);
    if (s.team === g.player.team) best.spotT = 3;
  } else if (ai.seen > 5 && !ai.target) {
    ai.alertT = 0;
  }
}

function steer(g: Game, s: Soldier, dt: number, tx: number, tz: number, speed: number, faceMove: boolean) {
  const ai = s.ai!;
  const dx = tx - s.pos.x, dz = tz - s.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) {
    g.moveSoldier(s, dt, 0, 0, 0, false);
    return d;
  }
  let dirx = dx / d, dirz = dz / d;
  // whiskers
  if (ai.unstick > 0) {
    ai.unstick -= dt;
    const a = ai.unstickDir;
    const c = Math.cos(a), sn = Math.sin(a);
    const nx = dirx * c - dirz * sn, nz = dirx * sn + dirz * c;
    dirx = nx; dirz = nz;
  } else if (ai.avoidT > 0) {
    ai.avoidT -= dt;
    const c = Math.cos(ai.avoid), sn = Math.sin(ai.avoid);
    const nx = dirx * c - dirz * sn, nz = dirx * sn + dirz * c;
    dirx = nx; dirz = nz;
  } else {
    const oy = s.pos.y + 0.8;
    const len = Math.min(d, 3.6);
    const hit = g.world.raycast(s.pos.x, oy, s.pos.z, dirx, 0, dirz, len);
    if (hit && hit.collider) {
      const test = (a: number) => {
        const c = Math.cos(a), sn = Math.sin(a);
        const h = g.world.raycast(s.pos.x, oy, s.pos.z, dirx * c - dirz * sn, 0, dirx * sn + dirz * c, 5);
        return h ? h.t : 5;
      };
      const l = test(0.8), r = test(-0.8);
      const l2 = test(1.5), r2 = test(-1.5);
      const sl = l + l2, sr = r + r2;
      ai.avoid = sl >= sr ? 1.0 : -1.0;
      if (Math.max(l, r) < 2) ai.avoid *= 1.7;
      ai.avoidT = 0.45 + rand() * 0.5;
    }
  }
  // stuck detection
  ai.stuckT += dt;
  if (ai.stuckT > 1.1) {
    const moved = Math.hypot(s.pos.x - ai.lastPos.x, s.pos.z - ai.lastPos.z);
    if (moved < 0.7 * (speed / 4.4) && d > 2) {
      ai.unstick = 0.9 + rand() * 0.8;
      ai.unstickDir = (rand() < 0.5 ? -1 : 1) * (1.2 + rand() * 1.2);
      ai.jumpT = 0.1;
    }
    ai.lastPos.copy(s.pos);
    ai.stuckT = 0;
  }
  let jump = false;
  if (ai.jumpT > 0) { ai.jumpT -= dt; jump = s.grounded; }
  g.moveSoldier(s, dt, dirx, dirz, speed, jump);
  if (faceMove) turnTo(s, Math.atan2(-dirx, -dirz), 6, dt);
  return d;
}

export function updateAI(g: Game, s: Soldier, dt: number) {
  const ai = s.ai!;
  ai.perceptT -= dt; ai.thinkT -= dt; ai.burstCd -= dt; ai.grenadeCd -= dt; ai.coverT -= dt; ai.strafeT -= dt; ai.react -= dt; ai.seen += dt; ai.holdT -= dt;
  ai.alertT = Math.max(0, ai.alertT - dt);
  if (ai.perceptT <= 0) { ai.perceptT = 0.2 + rand() * 0.15; perceive(g, s); }
  const w = s.w;
  const def = w.def;
  const tgt = ai.target;
  const visible = !!tgt && ai.seen < 0.5;

  // ---- decision
  if (ai.thinkT <= 0) {
    ai.thinkT = 0.35 + rand() * 0.3;
    if (tgt && ai.seen < 2.5) {
      const hpFrac = s.hp / s.maxHp;
      if (hpFrac < 0.45 && ai.state !== "cover" && ai.coverT <= 0) {
        const cv = findCover(g, s, tgt.pos.x, tgt.pos.z);
        if (cv) { ai.cover = cv; ai.coverT = 3 + rand() * 3; ai.state = "cover"; }
        else ai.state = "engage";
      } else if (ai.state !== "cover") ai.state = "engage";
      else if (ai.coverT <= 0) { ai.state = "engage"; }
      // grenade
      if (visible && ai.grenadeCd <= 0 && s.grenades > 0) {
        const d = Math.hypot(tgt.pos.x - s.pos.x, tgt.pos.z - s.pos.z);
        if (d > 11 && d < 30 && rand() < 0.45) {
          const T = Math.min(1.7, Math.max(0.7, d / 17));
          const gv = 22;
          g.throwGrenade(s, (tgt.pos.x - s.pos.x) / T, (tgt.pos.y + 0.5 - (s.pos.y + 1.4)) / T + 0.5 * gv * T, (tgt.pos.z - s.pos.z) / T);
          ai.grenadeCd = 12 + rand() * 14;
        } else ai.grenadeCd = 3 + rand() * 4;
      }
    } else if (ai.seen < 7 && ai.alertT > 0) {
      ai.state = "investigate";
    } else if (ai.state === "engage" || ai.state === "cover" || ai.state === "investigate") {
      ai.state = "move";
      ai.target = null;
      g.assignGoal(s);
    }
    // objective re-eval
    ai.repathT -= 0.5;
    if (ai.repathT <= 0 && (ai.state === "move" || ai.state === "hold")) { ai.repathT = 18 + rand() * 14; g.assignGoal(s); if (ai.state === "hold") ai.state = "move"; }
    // reload logic
    if (!def.energy && w.reload < 0 && (w.ammo === 0 || (w.ammo < def.mag * 0.35 && !visible))) g.startReload(s);
    if (def.energy && w.overheated && s.weapons.length > 1 && s.cur === 0) g.switchWeapon(s, 1);
    else if (def.energy && !w.overheated && s.cur !== 0 && s.weapons[0].def.energy) g.switchWeapon(s, 0);
    // weapon swap if empty and no reserve is unnecessary: AI has infinite reserve
  }

  // ---- movement & combat
  let sprint = false;
  let aimUp = 0;
  let speedBase = 4.4 * s.speedMul * def.moveMul;
  s.crouch = false;
  switch (ai.state) {
    case "move":
    case "hold": {
      const gx = ai.goal.x, gz = ai.goal.z;
      const d = Math.hypot(gx - s.pos.x, gz - s.pos.z);
      if (ai.state === "move" && d < 4) { ai.state = "hold"; ai.holdT = 4 + rand() * 6; }
      if (ai.state === "hold") {
        if (ai.holdT <= 0) { g.assignGoalHold(s); ai.holdT = 4 + rand() * 6; if (rand() < 0.2) g.assignGoal(s), (ai.state = "move"); }
        const dh = steer(g, s, dt, gx, gz, speedBase * 0.7, true);
        if (dh < 0.8) { s.crouch = rand() < 0.002 ? !s.crouch : s.crouch; turnTo(s, s.yaw + Math.sin(g.time * 0.7 + s.id) * 0.6, 1.2, dt); }
      } else {
        sprint = d > 14;
        steer(g, s, dt, gx, gz, speedBase * (sprint ? 1.5 : 1), true);
      }
      s.pitch += (0 - s.pitch) * Math.min(1, dt * 4);
      break;
    }
    case "investigate": {
      const d = steer(g, s, dt, ai.lastKnown.x, ai.lastKnown.z, speedBase * 1.1, true);
      if (d < 3) { ai.alertT = 0; ai.seen = 99; ai.state = "move"; ai.target = null; g.assignGoal(s); }
      break;
    }
    case "cover": {
      if (ai.cover) {
        const d = Math.hypot(ai.cover.x - s.pos.x, ai.cover.z - s.pos.z);
        if (d > 1.3) steer(g, s, dt, ai.cover.x, ai.cover.z, speedBase * 1.4, false);
        else { s.crouch = true; g.moveSoldier(s, dt, 0, 0, 0, false); }
        sprint = d > 4;
        if (tgt) turnTo(s, Math.atan2(-(tgt.pos.x - s.pos.x), -(tgt.pos.z - s.pos.z)), 5, dt);
      }
      break;
    }
    case "engage": {
      if (!tgt) break;
      const dx = tgt.pos.x - s.pos.x, dz = tgt.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      const nx = dx / d, nz = dz / d;
      if (ai.strafeT <= 0) { ai.strafeT = 0.9 + rand() * 1.8; ai.strafe = rand() < 0.5 ? -1 : 1; }
      let wx = 0, wz = 0;
      const ideal = def.id === "sg12" ? 8 : def.id === "lr50" ? 70 : def.aiRange * 0.55;
      if (!visible && ai.seen > 0.8) {
        wx = nx; wz = nz; // advance to re-acquire
      } else if (d > ideal * 1.25) { wx = nx * 0.9 - nz * ai.strafe * 0.3; wz = nz * 0.9 + nx * ai.strafe * 0.3; }
      else if (d < ideal * 0.5 && def.id !== "sg12") { wx = -nx * 0.7 - nz * ai.strafe * 0.5; wz = -nz * 0.7 + nx * ai.strafe * 0.5; }
      else { wx = -nz * ai.strafe; wz = nx * ai.strafe; }
      if (def.id === "lr50") { wx *= 0.2; wz *= 0.2; s.crouch = d > 30; }
      const wl = Math.hypot(wx, wz) || 1;
      // avoid walls via steer-like probe
      const ahead = g.world.raycast(s.pos.x, s.pos.y + 0.8, s.pos.z, wx / wl, 0, wz / wl, 2.2);
      if (ahead && ahead.collider) { ai.strafe *= -1; wx = -wx; wz = -wz; }
      const sp = speedBase * 0.8 * (def.id === "lr50" ? 0.3 : 1);
      g.moveSoldier(s, dt, wx / wl, wz / wl, sp, false);
      // aim
      const lead = d / def.speed;
      const ax = tgt.pos.x + tgt.vel.x * lead * 0.6, az = tgt.pos.z + tgt.vel.z * lead * 0.6;
      const headTarget = def.id === "lr50" || (rand() < 0.15 * ai.skill);
      const ay = tgt.pos.y + (headTarget ? 1.62 : tgt.crouch ? 0.8 : 1.15);
      const ddx = ax - s.pos.x, ddz = az - s.pos.z;
      const dh = Math.hypot(ddx, ddz);
      const wantYaw = Math.atan2(-ddx, -ddz);
      const wantPitch = Math.atan2(ay - s.eyeY, dh);
      turnTo(s, wantYaw, 5.5 * ai.skill, dt);
      s.pitch += (wantPitch - s.pitch) * Math.min(1, dt * 8);
      aimUp = wantPitch;
      const yawErr = Math.abs(angleDiff(s.yaw, wantYaw));
      // fire
      if (visible && ai.react <= 0 && yawErr < 0.09 && w.reload < 0 && !(def.energy && w.overheated) && w.ammo + (def.energy ? 1 : 0) > 0 && d < def.aiRange * 1.15) {
        if (ai.burst <= 0 && ai.burstCd <= 0) ai.burst = def.auto ? 3 + Math.floor(rand() * 5) : 1;
        if (ai.burst > 0 && w.cd <= 0) {
          const moving = Math.hypot(s.vel.x, s.vel.z) > 1;
          const err = (def.spread * 0.8 + 1.2 / ai.skill + d * 0.025 + (moving ? 0.9 : 0.2)) * (def.id === "lr50" ? 0.5 : 1);
          g.aiFire(s, ax, ay, az, err);
          ai.burst--;
          if (ai.burst <= 0) ai.burstCd = (def.auto ? 0.35 : 0.5) + rand() * 0.7 / ai.skill;
        }
      }
      break;
    }
  }
  s.sprint = sprint;
  s.ads = ai.state === "engage" && visible ? 1 : 0;
  void aimUp;
}
