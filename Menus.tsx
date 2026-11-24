import { useState } from "react";
import type { ClassId, HudState, MapId, MatchConfig, ModeId, Quality, Settings } from "../game/types";
import { CLASSES, WEAPONS } from "../game/weapons";
import { MAP_INFO } from "../game/maps";
import { audio } from "../game/audio";

export const PRESETS: Record<Quality, Partial<Settings>> = {
  low: { shadows: true, bloom: false, dof: false, motionBlur: false, godrays: false, ssao: false, resolutionScale: 0.75, aiPerTeam: 8 },
  medium: { shadows: true, bloom: true, dof: false, motionBlur: false, godrays: true, ssao: false, resolutionScale: 0.9, aiPerTeam: 12 },
  high: { shadows: true, bloom: true, dof: true, motionBlur: true, godrays: true, ssao: false, resolutionScale: 1, aiPerTeam: 14 },
  ultra: { shadows: true, bloom: true, dof: true, motionBlur: true, godrays: true, ssao: true, resolutionScale: 1, aiPerTeam: 20 },
};

const MODES: { id: ModeId; name: string; desc: string }[] = [
  { id: "conquest", name: "CONQUEST", desc: "Two armies fight for five capture points. Hold more points to bleed enemy tickets. Large-scale AI warfare." },
  { id: "tdm", name: "TEAM DEATHMATCH", desc: "First team to 60 eliminations or the highest score at 10:00 wins. Fast respawns, constant action." },
  { id: "assault", name: "OBJECTIVE ASSAULT", desc: "Attackers push through three staged objectives with limited reinforcements. Defenders must hold the line." },
];

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs font-semibold tracking-[.18em] opacity-85"><span>{label}</span><span className="font-display">{fmt ? fmt(value) : value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="flex w-full items-center justify-between py-1.5 text-xs font-semibold tracking-[.18em]" onClick={() => { audio.ui("click"); onChange(!value); }}>
      <span className="opacity-85">{label}</span>
      <span className="font-display h-5 w-10 rounded-sm px-0.5" style={{ background: value ? "rgba(90,208,255,.35)" : "rgba(255,255,255,.12)", border: `1px solid ${value ? "#5ad0ff" : "rgba(255,255,255,.2)"}` }}>
        <span className="block h-full w-4 transition-all" style={{ marginLeft: value ? 18 : 0, background: value ? "#5ad0ff" : "#8a97a3" }} />
      </span>
    </button>
  );
}

export function SettingsPanel({ s, onChange, onClose, inGame }: { s: Settings; onChange: (s: Settings) => void; onClose: () => void; inGame: boolean }) {
  const [tab, setTab] = useState<"gfx" | "audio" | "ctrl">("gfx");
  const set = (p: Partial<Settings>) => onChange({ ...s, ...p });
  return (
    <div className="panel anim-up pointer-events-auto w-[640px] max-w-[94vw] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="font-display text-xl font-bold tracking-[.25em]">SETTINGS</div>
        <button className="btn-ghost" onClick={() => { audio.ui("click"); onClose(); }}>BACK</button>
      </div>
      <div className="mb-5 flex gap-2">
        {([["gfx", "GRAPHICS"], ["audio", "AUDIO"], ["ctrl", "CONTROLS"]] as const).map(([k, n]) => (
          <button key={k} onClick={() => { audio.ui("click"); setTab(k); }} className="font-display flex-1 py-2 text-xs tracking-[.2em]" style={{ borderBottom: `2px solid ${tab === k ? "#5ad0ff" : "rgba(255,255,255,.12)"}`, color: tab === k ? "#fff" : "#8a97a3" }}>{n}</button>
        ))}
      </div>
      <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-2">
        {tab === "gfx" && (
          <>
            <div>
              <div className="mb-2 text-xs font-semibold tracking-[.18em] opacity-85">QUALITY PRESET</div>
              <div className="grid grid-cols-4 gap-2">
                {(["low", "medium", "high", "ultra"] as Quality[]).map((q) => (
                  <button key={q} className={`card font-display py-2 text-xs tracking-[.2em] ${s.quality === q ? "sel" : ""}`} onClick={() => { audio.ui("click"); onChange({ ...s, ...PRESETS[q], quality: q }); }}>{q.toUpperCase()}</button>
                ))}
              </div>
              <div className="mt-2 text-[11px] opacity-60">{inGame ? "Texture resolution & foliage density change on next map load." : "Changing preset reloads the battlefield with new texture/geometry quality."}</div>
            </div>
            <Slider label="RENDER RESOLUTION" value={s.resolutionScale} min={0.5} max={1.5} step={0.05} onChange={(v) => set({ resolutionScale: v })} fmt={(v) => Math.round(v * 100) + "%"} />
            <Slider label="AI SOLDIERS PER TEAM (next match)" value={s.aiPerTeam} min={6} max={28} step={1} onChange={(v) => set({ aiPerTeam: v })} />
            <Slider label="FIELD OF VIEW" value={s.fov} min={60} max={110} step={1} onChange={(v) => set({ fov: v })} fmt={(v) => v + "°"} />
            <div className="grid grid-cols-2 gap-x-8">
              <Toggle label="REAL-TIME SHADOWS" value={s.shadows} onChange={(v) => set({ shadows: v })} />
              <Toggle label="BLOOM" value={s.bloom} onChange={(v) => set({ bloom: v })} />
              <Toggle label="DEPTH OF FIELD" value={s.dof} onChange={(v) => set({ dof: v })} />
              <Toggle label="MOTION BLUR" value={s.motionBlur} onChange={(v) => set({ motionBlur: v })} />
              <Toggle label="VOLUMETRIC GOD RAYS" value={s.godrays} onChange={(v) => set({ godrays: v })} />
              <Toggle label="AMBIENT OCCLUSION" value={s.ssao} onChange={(v) => set({ ssao: v })} />
              <Toggle label="SHOW FPS" value={s.showFps} onChange={(v) => set({ showFps: v })} />
            </div>
          </>
        )}
        {tab === "audio" && (
          <>
            <Slider label="MASTER VOLUME" value={s.master} min={0} max={1} step={0.01} onChange={(v) => set({ master: v })} fmt={(v) => Math.round(v * 100) + "%"} />
            <Slider label="EFFECTS" value={s.sfx} min={0} max={1} step={0.01} onChange={(v) => set({ sfx: v })} fmt={(v) => Math.round(v * 100) + "%"} />
            <Slider label="MUSIC" value={s.music} min={0} max={1} step={0.01} onChange={(v) => set({ music: v })} fmt={(v) => Math.round(v * 100) + "%"} />
            <Slider label="AMBIENCE" value={s.ambient} min={0} max={1} step={0.01} onChange={(v) => set({ ambient: v })} fmt={(v) => Math.round(v * 100) + "%"} />
            <Toggle label="HRTF 3D SPATIAL AUDIO" value={s.hrtf} onChange={(v) => set({ hrtf: v })} />
            <button className="btn-ghost" onClick={() => audio.fire("ar7", null, 0)}>TEST WEAPON SOUND</button>
          </>
        )}
        {tab === "ctrl" && (
          <>
            <Slider label="MOUSE SENSITIVITY" value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => set({ sensitivity: v })} fmt={(v) => v.toFixed(2)} />
            <Slider label="ADS SENSITIVITY" value={s.adsSensitivity} min={0.2} max={1.5} step={0.05} onChange={(v) => set({ adsSensitivity: v })} fmt={(v) => v.toFixed(2)} />
            <Toggle label="INVERT Y AXIS" value={s.invertY} onChange={(v) => set({ invertY: v })} />
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 pt-2 text-xs tracking-widest opacity-80">
              {[["WASD", "Move"], ["SHIFT", "Sprint"], ["CTRL / C", "Crouch"], ["SPACE", "Jump"], ["LMB", "Fire"], ["RMB", "Aim down sights"], ["R", "Reload"], ["1 / 2 / 3 / WHEEL", "Switch weapon"], ["G", "Thermal detonator"], ["V", "Third-person camera"], ["ESC", "Pause"]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-white/5 py-1"><span className="font-display text-[10px]" style={{ color: "#8fe3ff" }}>{k}</span><span>{v}</span></div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MainMenu({ cfg, setCfg, onPlay, onSettings, mapName, mapSub, screen, setScreen }: {
  cfg: MatchConfig; setCfg: (c: MatchConfig) => void; onPlay: () => void; onSettings: () => void; mapName: string; mapSub: string; screen: "main" | "play"; setScreen: (s: "main" | "play") => void;
}) {
  const info = MAP_INFO[cfg.map];
  return (
    <div className="absolute inset-0 flex items-stretch" style={{ background: "linear-gradient(90deg, rgba(3,6,10,.92) 0%, rgba(3,6,10,.55) 34%, rgba(3,6,10,0) 62%), linear-gradient(0deg, rgba(0,0,0,.65), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 80%, rgba(0,0,0,.5))" }}>
      <div className="absolute left-0 right-0 top-0 h-10 bg-black/80" />
      <div className="absolute bottom-0 left-0 right-0 h-10 bg-black/80" />
      <div className="relative flex w-full max-w-[1100px] flex-col justify-center pl-16 pr-6">
        <div className="anim-up mb-2 text-xs tracking-[.5em]" style={{ color: "#5ad0ff" }}>GALACTIC CONFLICT · SEASON IV</div>
        <h1 className="anim-up font-display text-6xl font-black leading-[0.95]" style={{ animationDelay: ".05s", textShadow: "0 0 40px rgba(90,208,255,.35)" }}>STARFALL</h1>
        <h2 className="anim-up font-display mb-10 text-3xl font-bold tracking-[.55em]" style={{ animationDelay: ".1s", color: "#ffb347" }}>BATTLEFRONT</h2>
        {screen === "main" ? (
          <div className="anim-up w-[360px] space-y-2" style={{ animationDelay: ".2s" }}>
            <button className="btn-menu" onMouseEnter={() => audio.ui("hover")} onClick={() => { audio.ui("click"); setScreen("play"); }}>Deploy to Battle</button>
            <button className="btn-menu" onMouseEnter={() => audio.ui("hover")} onClick={() => { audio.ui("click"); onSettings(); }}>Settings</button>
            <div className="pt-6 text-[11px] leading-5 tracking-[.2em] opacity-60">
              LIVE BATTLEFIELD FEED<br />
              <span style={{ color: "#8fe3ff" }}>{mapName}</span> — {mapSub}
            </div>
          </div>
        ) : (
          <div className="panel anim-up pointer-events-auto w-[860px] max-w-[92vw] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-sm tracking-[.3em]">OPERATION BRIEFING</div>
              <button className="btn-ghost" onClick={() => { audio.ui("click"); setScreen("main"); }}>BACK</button>
            </div>
            <div className="mb-1 text-[11px] tracking-[.25em] opacity-60">GAME MODE</div>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <div key={m.id} className={`card p-3 ${cfg.mode === m.id ? "sel" : ""}`} onMouseEnter={() => audio.ui("hover")} onClick={() => { audio.ui("click"); setCfg({ ...cfg, mode: m.id }); }}>
                  <div className="font-display text-xs font-bold tracking-[.18em]">{m.name}</div>
                  <div className="mt-1 text-[12px] leading-4 opacity-70">{m.desc}</div>
                </div>
              ))}
            </div>
            <div className="mb-1 text-[11px] tracking-[.25em] opacity-60">BATTLEFIELD</div>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {(Object.keys(MAP_INFO) as MapId[]).map((id) => (
                <div key={id} className={`card overflow-hidden ${cfg.map === id ? "sel" : ""}`} onMouseEnter={() => audio.ui("hover")} onClick={() => { audio.ui("click"); setCfg({ ...cfg, map: id }); }}>
                  <div className="h-14" style={{ background: `linear-gradient(135deg, ${MAP_INFO[id].colors[0]}, ${MAP_INFO[id].colors[1]})` }} />
                  <div className="p-2">
                    <div className="font-display text-[10px] font-bold tracking-[.12em]">{MAP_INFO[id].name.replace("THE ", "")}</div>
                    <div className="text-[11px] opacity-60">{MAP_INFO[id].sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-4 text-[13px] leading-5 opacity-80">{info.desc}</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1 text-[11px] tracking-[.25em] opacity-60">FACTION</div>
                <div className="grid grid-cols-2 gap-2">
                  {([0, 1] as const).map((t) => (
                    <div key={t} className={`card p-2 text-center ${cfg.team === t ? "sel" : ""}`} onClick={() => { audio.ui("click"); setCfg({ ...cfg, team: t }); }}>
                      <div className="font-display text-xs font-bold tracking-[.2em]" style={{ color: t === 0 ? "#4fb8ff" : "#ff5a4a" }}>{t === 0 ? "AEGIS COALITION" : "DOMINION LEGION"}</div>
                      <div className="text-[11px] opacity-60">{t === 0 ? "Attackers in Assault" : "Defenders in Assault"}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] tracking-[.25em] opacity-60">STARTING CLASS</div>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.keys(CLASSES) as ClassId[]).map((c) => (
                    <div key={c} className={`card p-2 text-center ${cfg.cls === c ? "sel" : ""}`} onClick={() => { audio.ui("click"); setCfg({ ...cfg, cls: c }); }}>
                      <div className="font-display text-[10px] font-bold tracking-[.12em]">{CLASSES[c].name}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button className="btn-primary" onMouseEnter={() => audio.ui("hover")} onClick={() => { audio.ui("start"); onPlay(); }}>Begin Operation</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DeployScreen({ hud, cls, setCls, onDeploy, spawnSel, setSpawnSel }: { hud: HudState; cls: ClassId; setCls: (c: ClassId) => void; onDeploy: () => void; spawnSel: number; setSpawnSel: (n: number) => void }) {
  const dead = hud.phase === "dead";
  const waiting = dead && hud.respawnIn > 0;
  const c = CLASSES[cls];
  return (
    <div className="absolute inset-0 flex items-end justify-center pb-10" style={{ background: "linear-gradient(0deg, rgba(0,0,0,.85), rgba(0,0,0,.2) 55%, rgba(0,0,0,.35))" }}>
      {dead && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 text-center">
          <div className="font-display text-4xl font-black tracking-[.3em]" style={{ color: "#ff5a4a" }}>ELIMINATED</div>
          <div className="mt-2 text-sm tracking-[.25em] opacity-80">{hud.killedBy ? "BY " + hud.killedBy.toUpperCase() : ""}</div>
        </div>
      )}
      <div className="panel pointer-events-auto anim-up w-[1000px] max-w-[96vw] p-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="font-display text-sm tracking-[.3em]" style={{ color: "#5ad0ff" }}>{hud.mapName} — {hud.mapSub}</div>
            <div className="text-xs tracking-[.2em] opacity-60">{hud.objective}</div>
          </div>
          <div className="font-display text-sm tracking-[.2em]">{waiting ? `REDEPLOY IN ${Math.ceil(hud.respawnIn)}` : "SELECT LOADOUT & SPAWN"}</div>
        </div>
        <div className="grid grid-cols-[1fr_260px] gap-5">
          <div>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(CLASSES) as ClassId[]).map((k) => (
                <div key={k} className={`card p-3 ${cls === k ? "sel" : ""}`} onMouseEnter={() => audio.ui("hover")} onClick={() => { audio.ui("click"); setCls(k); }}>
                  <div className="font-display text-sm font-bold tracking-[.15em]">{CLASSES[k].name}</div>
                  <div className="mt-1 text-[11px] leading-4 opacity-70">{CLASSES[k].desc}</div>
                  <div className="mt-2 flex gap-3 text-[10px] tracking-widest opacity-80"><span>HP {CLASSES[k].hp}</span><span>SPD {Math.round(CLASSES[k].speed * 100)}</span></div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {c.weapons.map((w, i) => {
                const d = WEAPONS[w];
                return (
                  <div key={w} className="p-2" style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)" }}>
                    <div className="flex justify-between text-[10px] tracking-widest opacity-60"><span>SLOT {i + 1}</span><span>{d.kind}</span></div>
                    <div className="font-display text-xs font-bold tracking-[.12em]">{d.name}</div>
                    <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] opacity-80">
                      <Bar label="DMG" v={Math.min(1, (d.dmg * d.pellets * 0.4) / 60)} />
                      <Bar label="RATE" v={Math.min(1, d.rpm / 800)} />
                      <Bar label="RANGE" v={Math.min(1, d.falloff[1] / 300)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col">
            <div className="mb-2 text-[11px] tracking-[.25em] opacity-60">SPAWN POINT</div>
            <div className="mb-3 flex-1 space-y-1.5">
              {hud.spawnOptions.map((o) => (
                <button key={o.id} className={`card font-display w-full px-3 py-2 text-left text-[11px] tracking-[.15em] ${spawnSel === o.id ? "sel" : ""}`} onClick={() => { audio.ui("click"); setSpawnSel(o.id); }}>{o.name}</button>
              ))}
            </div>
            <button className="btn-primary text-center" style={{ opacity: waiting ? 0.4 : 1 }} disabled={waiting} onClick={onDeploy}>{waiting ? `WAIT ${Math.ceil(hud.respawnIn)}` : "DEPLOY"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="opacity-60">{label}</div>
      <div className="h-1 w-full bg-white/10"><div className="h-full" style={{ width: `${v * 100}%`, background: "#5ad0ff" }} /></div>
    </div>
  );
}

export function PauseScreen({ onResume, onSettings, onQuit }: { onResume: () => void; onSettings: () => void; onQuit: () => void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center" style={{ background: "rgba(2,5,9,.7)", backdropFilter: "blur(6px)" }}>
      <div className="anim-up w-[340px] space-y-2">
        <div className="font-display mb-5 text-center text-2xl font-black tracking-[.4em]">PAUSED</div>
        <button className="btn-menu" onClick={() => { audio.ui("click"); onResume(); }}>Resume</button>
        <button className="btn-menu" onClick={() => { audio.ui("click"); onSettings(); }}>Settings</button>
        <button className="btn-menu" onClick={() => { audio.ui("click"); onQuit(); }}>Abandon Mission</button>
      </div>
    </div>
  );
}

export function EndScreen({ hud, onAgain, onMenu }: { hud: HudState; onAgain: () => void; onMenu: () => void }) {
  const e = hud.ended!;
  const win = e.winner === hud.playerTeam;
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(circle, rgba(0,0,0,.55), rgba(0,0,0,.9))" }}>
      <div className="anim-up text-center">
        <div className="font-display text-7xl font-black tracking-[.2em]" style={{ color: win ? "#7ee8ff" : "#ff5a4a", textShadow: `0 0 50px ${win ? "rgba(90,208,255,.6)" : "rgba(255,60,40,.6)"}` }}>{win ? "VICTORY" : "DEFEAT"}</div>
        <div className="mt-3 text-sm tracking-[.35em] opacity-80">{e.text}</div>
        <div className="mx-auto mt-8 grid w-[460px] grid-cols-3 gap-3">
          {[["ELIMINATIONS", hud.kills], ["DEATHS", hud.deaths], ["SCORE", hud.score]].map(([k, v]) => (
            <div key={k as string} className="panel p-3"><div className="text-[10px] tracking-[.25em] opacity-60">{k}</div><div className="font-display text-3xl font-black">{v}</div></div>
          ))}
        </div>
        <div className="mt-8 flex justify-center gap-4">
          <button className="btn-primary" onClick={onAgain}>Redeploy</button>
          <button className="btn-ghost" onClick={onMenu}>Main Menu</button>
        </div>
      </div>
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "radial-gradient(circle at 50% 40%, #0d1a28, #03060a)" }}>
      <div className="font-display text-4xl font-black tracking-[.3em]">STARFALL</div>
      <div className="font-display mb-10 text-lg tracking-[.6em]" style={{ color: "#ffb347" }}>BATTLEFRONT</div>
      <div className="relative h-1 w-80 overflow-hidden bg-white/10"><div className="absolute inset-y-0" style={{ width: "35%", background: "#5ad0ff", animation: "load 1.2s linear infinite", boxShadow: "0 0 14px #5ad0ff" }} /></div>
      <div className="anim-pulse mt-5 text-xs tracking-[.4em] opacity-70">{text}</div>
    </div>
  );
}
