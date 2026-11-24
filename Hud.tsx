import { useEffect, useRef } from "react";

let hintStart = -1;
import type { HudState } from "../game/types";

const TEAM_COL = ["#4fb8ff", "#ff5a4a"];
const TEAM_NAME = ["AEGIS", "DOMINION"];
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Minimap({ hud }: { hud: HudState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const S = c.width;
    const R = 95; // metres shown from centre to edge
    const sc = S / 2 / R;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    const bg = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
    bg.addColorStop(0, "rgba(14,30,44,0.88)");
    bg.addColorStop(1, "rgba(6,12,18,0.92)");
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    const fx = -Math.sin(hud.yaw), fz = -Math.cos(hud.yaw);
    const rx = Math.cos(hud.yaw), rz = -Math.sin(hud.yaw);
    const proj = (x: number, z: number) => {
      const dx = x - hud.px, dz = z - hud.pz;
      return [S / 2 + (dx * rx + dz * rz) * sc, S / 2 - (dx * fx + dz * fz) * sc];
    };
    // grid rings
    g.strokeStyle = "rgba(100,160,200,0.15)";
    g.lineWidth = 1;
    for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(S / 2, S / 2, (S / 2 / 3) * r, 0, 7); g.stroke(); }
    // world boundary
    const [bx, by] = proj(0, 0);
    g.strokeStyle = "rgba(255,160,60,0.45)";
    g.setLineDash([6, 6]);
    g.beginPath();
    g.arc(bx, by, hud.worldRadius * sc, 0, 7);
    g.stroke();
    g.setLineDash([]);
    // points
    for (const p of hud.points) {
      let [x, y] = proj(p.x, p.z);
      const dx = x - S / 2, dy = y - S / 2;
      const d = Math.hypot(dx, dy);
      const lim = S / 2 - 14;
      if (d > lim) { x = S / 2 + (dx / d) * lim; y = S / 2 + (dy / d) * lim; }
      const col = p.owner === 0 ? TEAM_COL[0] : p.owner === 1 ? TEAM_COL[1] : "#cfd8e0";
      g.globalAlpha = p.active ? 1 : 0.4;
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill();
      g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 10, 0, 7); g.stroke();
      g.fillStyle = col; g.font = "bold 12px Orbitron, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(p.name.length === 1 ? p.name : p.name[0], x, y + 1);
      g.globalAlpha = 1;
    }
    for (const e of hud.minimap) {
      const [x, y] = proj(e.x, e.z);
      if (Math.hypot(x - S / 2, y - S / 2) > S / 2 - 4) continue;
      g.fillStyle = TEAM_COL[e.team];
      g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill();
    }
    g.restore();
    // player arrow
    g.save();
    g.translate(S / 2, S / 2);
    g.fillStyle = "#ffffff";
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();
    // view cone
    g.save();
    g.translate(S / 2, S / 2);
    const cone = g.createLinearGradient(0, 0, 0, -S / 2);
    cone.addColorStop(0, "rgba(255,255,255,0.22)");
    cone.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = cone;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-S * 0.22, -S / 2); g.lineTo(S * 0.22, -S / 2); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = "rgba(140,200,240,0.55)";
    g.lineWidth = 2;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.stroke();
  }, [hud]);
  return <canvas ref={ref} width={200} height={200} className="rounded-full" style={{ width: 180, height: 180, boxShadow: "0 0 24px rgba(0,0,0,.6)" }} />;
}

export default function Hud({ hud, showFps }: { hud: HudState; showFps: boolean }) {
  if (hud.alive && hintStart < 0) hintStart = hud.time;
  if (hud.time < hintStart) hintStart = -1;
  const showHint = hud.alive && hintStart >= 0 && hud.time - hintStart < 14;
  const hmAge = hud.time - hud.hitMarker;
  const showHit = hmAge < 0.28 && hud.hitMarker > 0;
  const gap = Math.max(5, Math.min(70, hud.spread * (typeof window !== "undefined" ? window.innerHeight : 800) / 62));
  const hpFrac = hud.hp / hud.maxHp;
  const hpCol = hpFrac > 0.5 ? "#6fe0ff" : hpFrac > 0.25 ? "#ffc247" : "#ff4a3a";
  const w = hud.weapon;
  const mode = hud.mode;
  const scoreL = hud.tickets[0], scoreR = hud.tickets[1];
  const maxL = hud.ticketsMax[0], maxR = hud.ticketsMax[1];
  const dmg = Math.max(0, hud.dmgFlash);

  return (
    <div className="pointer-events-none fixed inset-0 select-none" style={{ color: "#e6f1fa" }}>
      {/* damage / low-health pulse */}
      <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 ${120 + dmg * 120}px rgba(255,20,10,${Math.min(0.7, dmg * 0.8 + (hpFrac < 0.3 ? 0.25 : 0))})` }} />

      {/* scope */}
      {hud.scoped && (
        <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, transparent 0, transparent 31vh, rgba(0,0,0,.96) 31.4vh)" }}>
          <div className="absolute left-1/2 top-1/2" style={{ width: "62vh", height: 1, background: "rgba(0,0,0,.85)", transform: "translate(-50%,-50%)" }} />
          <div className="absolute left-1/2 top-1/2" style={{ height: "62vh", width: 1, background: "rgba(0,0,0,.85)", transform: "translate(-50%,-50%)" }} />
          <div className="absolute left-1/2 top-1/2" style={{ width: 6, height: 6, background: "#ff3b2e", borderRadius: 3, transform: "translate(-50%,-50%)", boxShadow: "0 0 8px #f00" }} />
          {[-24, -16, -8, 8, 16, 24].map((v) => (
            <div key={v} className="absolute left-1/2 top-1/2" style={{ width: 14, height: 1, background: "rgba(0,0,0,.85)", transform: `translate(-50%, ${v}px)` }} />
          ))}
        </div>
      )}

      {/* crosshair */}
      {hud.alive && !hud.scoped && (
        <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%,-50%)" }}>
          {[0, 90, 180, 270].map((r) => (
            <div key={r} className="absolute" style={{ left: -1, top: -7, width: 2, height: 11, background: "rgba(235,248,255,.92)", boxShadow: "0 0 4px rgba(0,0,0,.9)", transform: `rotate(${r}deg) translateY(${-gap}px)`, transformOrigin: "1px 7px" }} />
          ))}
          <div className="absolute" style={{ left: -1.5, top: -1.5, width: 3, height: 3, borderRadius: 3, background: "rgba(255,255,255,.9)", boxShadow: "0 0 4px #000" }} />
          {showHit && (
            <div className="absolute" style={{ left: -16, top: -16, width: 32, height: 32, opacity: 1 - hmAge / 0.28, transform: `scale(${1 + hmAge * 1.5})` }}>
              {[45, 135, 225, 315].map((r) => (
                <div key={r} className="absolute" style={{ left: 15, top: 2, width: 2, height: 9, background: hud.hitKill ? "#ff4030" : hud.hitHead ? "#ffd24a" : "#fff", transform: `rotate(${r}deg) translateY(-6px)`, transformOrigin: "1px 14px", boxShadow: "0 0 6px rgba(0,0,0,.9)" }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* damage indicators */}
      {hud.damageDirs.map((d, i) => {
        const age = hud.time - d.t;
        return (
          <div key={i} className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%,-50%) rotate(${(-d.a * 180) / Math.PI}deg)`, opacity: Math.max(0, 1 - age / 2.2) }}>
            <div style={{ width: 220, height: 220, position: "absolute", left: -110, top: -110 }}>
              <div style={{ position: "absolute", left: 60, top: 0, width: 100, height: 22, background: "radial-gradient(ellipse at 50% 0%, rgba(255,40,30,.95), rgba(255,40,30,0) 70%)" }} />
            </div>
          </div>
        );
      })}

      {/* objective markers */}
      {hud.alive && hud.points.map((p) => p.onScreen && p.active && (
        <div key={p.name + p.x} className="absolute flex flex-col items-center" style={{ left: `${p.screenX}%`, top: `${p.screenY}%`, transform: "translate(-50%,-50%)" }}>
          <div className="font-display flex h-9 w-9 items-center justify-center rounded-sm text-sm font-bold hud-shadow" style={{ border: `2px solid ${p.owner === 0 ? TEAM_COL[0] : p.owner === 1 ? TEAM_COL[1] : "#e0e8ee"}`, background: "rgba(0,0,0,.45)", color: p.owner === 0 ? TEAM_COL[0] : p.owner === 1 ? TEAM_COL[1] : "#e0e8ee", transform: "rotate(45deg)" }}>
            <span style={{ transform: "rotate(-45deg)" }}>{p.name.length <= 2 ? p.name : p.name[0]}</span>
          </div>
          <div className="mt-2 text-xs font-semibold hud-shadow" style={{ opacity: 0.85 }}>{Math.round(p.dist)}m</div>
        </div>
      ))}

      {/* top scoreboard */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center">
        <div className="flex items-stretch gap-3">
          <div className="flex w-52 flex-col items-end">
            <div className="font-display text-[10px] tracking-[.3em]" style={{ color: TEAM_COL[0] }}>{TEAM_NAME[0]}</div>
            <div className="font-display text-3xl font-black hud-shadow" style={{ color: TEAM_COL[0] }}>{Math.max(0, Math.ceil(scoreL))}</div>
            <div className="h-1.5 w-full" style={{ background: "rgba(255,255,255,.12)" }}>
              <div className="ml-auto h-full" style={{ width: `${Math.max(0, Math.min(100, (mode === "tdm" ? scoreL / maxL : scoreL / maxL) * 100))}%`, background: TEAM_COL[0], boxShadow: `0 0 10px ${TEAM_COL[0]}` }} />
            </div>
          </div>
          <div className="flex flex-col items-center justify-center px-3">
            <div className="font-display text-xl font-bold hud-shadow">{fmtTime(hud.timer)}</div>
            <div className="text-[10px] tracking-[.25em] opacity-70">{mode === "conquest" ? "CONQUEST" : mode === "tdm" ? "TEAM DEATHMATCH" : "OBJECTIVE ASSAULT"}</div>
          </div>
          <div className="flex w-52 flex-col items-start">
            <div className="font-display text-[10px] tracking-[.3em]" style={{ color: TEAM_COL[1] }}>{TEAM_NAME[1]}</div>
            <div className="font-display text-3xl font-black hud-shadow" style={{ color: TEAM_COL[1] }}>{mode === "assault" ? "∞" : Math.max(0, Math.ceil(scoreR))}</div>
            <div className="h-1.5 w-full" style={{ background: "rgba(255,255,255,.12)" }}>
              <div className="h-full" style={{ width: `${mode === "assault" ? 100 : Math.max(0, Math.min(100, (scoreR / maxR) * 100))}%`, background: TEAM_COL[1], boxShadow: `0 0 10px ${TEAM_COL[1]}` }} />
            </div>
          </div>
        </div>
        {mode === "conquest" && (
          <div className="mt-2 flex gap-2">
            {hud.points.map((p) => (
              <div key={p.x} className="font-display flex h-6 w-6 items-center justify-center text-[11px] font-bold" style={{ border: `1.5px solid ${p.owner === 0 ? TEAM_COL[0] : p.owner === 1 ? TEAM_COL[1] : "#aab"}`, color: p.owner === 0 ? TEAM_COL[0] : p.owner === 1 ? TEAM_COL[1] : "#ccd", background: "rgba(0,0,0,.45)", boxShadow: Math.abs(p.cap) < 1 && Math.abs(p.cap) > 0.01 ? "0 0 8px #ffb347" : undefined }}>
                {p.name[0]}
              </div>
            ))}
          </div>
        )}
        {mode === "assault" && <div className="font-display mt-1 text-[11px] tracking-[.25em] opacity-80">{hud.stageText}</div>}
        <div className="mt-1 text-[11px] tracking-[.22em] opacity-80 hud-shadow">{hud.objective}</div>
      </div>

      {/* minimap */}
      <div className="absolute left-5 top-5"><Minimap hud={hud} /></div>

      {/* kill feed */}
      <div className="absolute right-5 top-5 flex w-80 flex-col items-end gap-1">
        {hud.feed.map((f) => (
          <div key={f.id} className="anim-slide flex items-center gap-2 rounded-sm px-3 py-1 text-sm font-semibold" style={{ background: "rgba(0,0,0,.5)", borderRight: `3px solid ${TEAM_COL[f.kTeam]}` }}>
            <span style={{ color: TEAM_COL[f.kTeam] }}>{f.killer}</span>
            <span className="text-[10px] tracking-widest opacity-70">{f.weapon.split(" ")[0]}{f.headshot ? " ◆" : ""}</span>
            <span style={{ color: TEAM_COL[f.vTeam] }}>{f.victim}</span>
          </div>
        ))}
      </div>

      {/* message */}
      {hud.message && (
        <div key={hud.messageT} className="anim-up font-display absolute left-1/2 top-[22%] -translate-x-1/2 text-center text-xl font-bold tracking-[.3em] hud-shadow" style={{ color: "#fff" }}>
          {hud.message}
        </div>
      )}

      {/* bottom-left health */}
      {hud.alive && (
        <div className="absolute bottom-6 left-6 w-72">
          <div className="mb-1 flex items-end justify-between">
            <div className="font-display text-[10px] tracking-[.3em] opacity-70">{hud.cls.toUpperCase()}</div>
            <div className="font-display text-4xl font-black leading-none hud-shadow" style={{ color: hpCol }}>{Math.ceil(hud.hp)}</div>
          </div>
          <div className="h-2.5 w-full" style={{ background: "rgba(255,255,255,.14)", clipPath: "polygon(0 0,100% 0,calc(100% - 8px) 100%,0 100%)" }}>
            <div className="h-full transition-[width] duration-150" style={{ width: `${Math.max(0, hpFrac * 100)}%`, background: `linear-gradient(90deg, ${hpCol}, #fff8)`, boxShadow: `0 0 14px ${hpCol}` }} />
          </div>
          <div className="mt-2 flex gap-4 text-xs font-semibold tracking-widest opacity-80">
            <span>K {hud.kills}</span><span>D {hud.deaths}</span><span>SCORE {hud.score}</span>
            {hud.sprint && <span style={{ color: "#8fe3ff" }}>SPRINT</span>}
            {hud.crouch && <span style={{ color: "#ffd27a" }}>CROUCH</span>}
          </div>
        </div>
      )}

      {/* bottom-right weapon */}
      {hud.alive && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end">
          <div className="mb-1 flex gap-2">
            {w.slots.map((s, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-widest" style={{ background: i === w.slot ? "rgba(90,208,255,.28)" : "rgba(0,0,0,.4)", border: `1px solid ${i === w.slot ? "#5ad0ff" : "rgba(255,255,255,.15)"}`, opacity: i === w.slot ? 1 : 0.65 }}>
                <span className="font-display">{i + 1}</span><span>{s.split(" ")[0]}</span>
              </div>
            ))}
          </div>
          <div className="font-display text-[11px] tracking-[.3em] opacity-80">{w.name}</div>
          {w.energy ? (
            <div className="mt-1 w-64">
              <div className="mb-1 flex justify-between text-[10px] tracking-widest" style={{ color: w.overheated ? "#ff5a3a" : "#ffb347" }}>
                <span>{w.overheated ? "OVERHEATED" : "CORE TEMP"}</span><span>{Math.round(w.heat * 100)}%</span>
              </div>
              <div className="h-3 w-full" style={{ background: "rgba(255,255,255,.14)" }}>
                <div className="h-full" style={{ width: `${w.heat * 100}%`, background: w.overheated ? "#ff3b2e" : `linear-gradient(90deg,#4fe0ff,#ffd04a ${60}%,#ff4a2a)`, boxShadow: "0 0 12px rgba(255,150,50,.7)" }} />
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-2 hud-shadow">
              <span className="font-display text-6xl font-black leading-none" style={{ color: w.ammo <= w.mag * 0.25 ? "#ff7a4a" : "#fff" }}>{w.ammo}</span>
              <span className="font-display text-2xl opacity-60">/ {w.reserve}</span>
            </div>
          )}
          {w.reloading > 0 && (
            <div className="mt-1 w-56">
              <div className="mb-0.5 text-right text-[10px] tracking-[.3em] opacity-80">RELOADING</div>
              <div className="h-1.5 w-full" style={{ background: "rgba(255,255,255,.15)" }}><div className="h-full" style={{ width: `${w.reloading * 100}%`, background: "#fff" }} /></div>
            </div>
          )}
          <div className="mt-2 flex items-center gap-1 text-xs tracking-widest opacity-90">
            <span className="font-display text-[10px] opacity-70">G</span>
            {Array.from({ length: Math.max(hud.grenades, 0) }).map((_, i) => (<span key={i} style={{ width: 8, height: 12, background: "#ffb347", display: "inline-block", borderRadius: 3, boxShadow: "0 0 6px #ff9a3a" }} />))}
          </div>
        </div>
      )}

      {/* controls hint */}
      {showHint && (
        <div className="anim-in absolute bottom-24 left-1/2 -translate-x-1/2 text-center text-[11px] leading-5 tracking-[.18em] opacity-60 hud-shadow">
          WASD MOVE · SHIFT SPRINT · CTRL/C CROUCH · SPACE JUMP · LMB FIRE · RMB AIM · R RELOAD · 1-3 / WHEEL WEAPON · G GRENADE · V CAMERA · ESC PAUSE
        </div>
      )}
      {showFps && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] opacity-70">{hud.fps} FPS</div>}
    </div>
  );
}
