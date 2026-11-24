import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "./game/engine";
import { DEFAULT_SETTINGS, type ClassId, type HudState, type MatchConfig, type Settings } from "./game/types";
import { audio } from "./game/audio";
import Hud from "./ui/Hud";
import { DeployScreen, EndScreen, Loading, MainMenu, PauseScreen, SettingsPanel } from "./ui/Menus";

const LS = "starfall_settings_v1";
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  const [hud, setHud] = useState<HudState | null>(null);
  const [busy, setBusy] = useState<string | null>("INITIALISING BATTLEFIELD");
  const [cfg, setCfg] = useState<MatchConfig>({ mode: "conquest", map: "desert", team: 0, cls: "assault" });
  const [menuScreen, setMenuScreen] = useState<"main" | "play">("main");
  const [showSettings, setShowSettings] = useState(false);
  const [cls, setCls] = useState<ClassId>("assault");
  const [spawnSel, setSpawnSel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // boot
  useEffect(() => {
    const canvas = canvasRef.current!;
    let game: Game;
    try {
      game = new Game(canvas, settingsRef.current, {
        onHud: (h) => setHud(h),
        onLock: () => { /* state flows through hud.paused */ },
      });
    } catch (e) {
      setError("WebGL initialisation failed: " + (e as Error).message);
      setBusy(null);
      return;
    }
    gameRef.current = game;
    const first = () => {
      game.startAudio();
      window.removeEventListener("pointerdown", first);
      window.removeEventListener("keydown", first);
    };
    window.addEventListener("pointerdown", first);
    window.addEventListener("keydown", first);
    game
      .startMatch({ mode: "conquest", map: "desert", team: 0, cls: "assault" }, false)
      .then(() => setBusy(null))
      .catch((e) => { console.error(e); setError("Failed to build battlefield: " + (e as Error).message); setBusy(null); });
    return () => {
      window.removeEventListener("pointerdown", first);
      window.removeEventListener("keydown", first);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const applySettings = useCallback((s: Settings) => {
    const prevQ = settingsRef.current.quality;
    settingsRef.current = s;
    setSettingsState(s);
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ }
    const g = gameRef.current;
    if (!g) return;
    g.setSettings(s);
    audio.applySettings(s);
    if (s.quality !== prevQ && g.phase === "menu") {
      setBusy("REBUILDING BATTLEFIELD");
      g.reloadForQuality().then(() => setBusy(null));
    }
  }, []);

  const phase = hud?.phase ?? "menu";

  const play = async () => {
    const g = gameRef.current;
    if (!g) return;
    setBusy("LOADING BATTLEFIELD");
    try {
      await g.startMatch(cfg, true);
    } catch (e) {
      console.error(e);
      setError("Match failed to start: " + (e as Error).message);
    }
    setCls(cfg.cls);
    setSpawnSel(0);
    setBusy(null);
  };

  const changeCfg = async (c: MatchConfig) => {
    const mapChanged = c.map !== cfg.map;
    setCfg(c);
    if (mapChanged && gameRef.current && phase === "menu") {
      setBusy("LOADING BATTLEFIELD");
      await gameRef.current.startMatch({ ...c, mode: "conquest" }, false);
      setBusy(null);
    }
  };

  const toMenu = async () => {
    const g = gameRef.current;
    if (!g) return;
    setShowSettings(false);
    setMenuScreen("main");
    setBusy("RETURNING TO COMMAND");
    await g.toMenu();
    setBusy(null);
  };

  const again = async () => {
    const g = gameRef.current;
    if (!g) return;
    setBusy("REDEPLOYING");
    await g.startMatch(g.cfg, true);
    setSpawnSel(0);
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <canvas id="game" ref={canvasRef} onContextMenu={(e) => e.preventDefault()} />
      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-8 text-center">
          <div>
            <div className="font-display mb-3 text-2xl" style={{ color: "#ff5a4a" }}>SYSTEM ERROR</div>
            <div className="text-sm opacity-80">{error}</div>
            <div className="mt-4 text-xs opacity-50">This game requires a WebGL2-capable browser and GPU.</div>
          </div>
        </div>
      )}
      {hud && (phase === "playing" || phase === "ended" || phase === "dead") && !busy && <Hud hud={hud} showFps={settings.showFps} />}

      {hud && phase === "menu" && !busy && (
        <>
          {!showSettings && (
            <MainMenu cfg={cfg} setCfg={changeCfg} onPlay={play} onSettings={() => setShowSettings(true)} mapName={hud.mapName} mapSub={hud.mapSub} screen={menuScreen} setScreen={setMenuScreen} />
          )}
          {showSettings && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60"><SettingsPanel s={settings} onChange={applySettings} onClose={() => setShowSettings(false)} inGame={false} /></div>
          )}
        </>
      )}

      {hud && (phase === "deploy" || phase === "dead") && !busy && (hud.respawnIn >= 0) && (
        <DeployScreen hud={hud} cls={cls} setCls={setCls} spawnSel={spawnSel} setSpawnSel={setSpawnSel} onDeploy={() => { gameRef.current?.deploy(cls, spawnSel); }} />
      )}

      {hud && phase === "playing" && hud.paused && !busy && (
        <>
          {!showSettings && <PauseScreen onResume={() => gameRef.current?.resume()} onSettings={() => setShowSettings(true)} onQuit={toMenu} />}
          {showSettings && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70"><SettingsPanel s={settings} onChange={applySettings} onClose={() => setShowSettings(false)} inGame /></div>
          )}
        </>
      )}

      {hud && phase === "ended" && hud.ended && !busy && <EndScreen hud={hud} onAgain={again} onMenu={toMenu} />}

      {busy && <Loading text={busy} />}
    </div>
  );
}
