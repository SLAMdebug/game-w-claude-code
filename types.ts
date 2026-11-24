export type ModeId = "conquest" | "tdm" | "assault";
export type MapId = "desert" | "industrial" | "jungle" | "frozen";
export type ClassId = "assault" | "heavy" | "sniper" | "breacher";
export type Quality = "low" | "medium" | "high" | "ultra";
export type Surface = "sand" | "rock" | "metal" | "concrete" | "mud" | "grass" | "snow" | "ice" | "water" | "wood";

export interface Settings {
  quality: Quality;
  sensitivity: number; // 0.2 - 3
  adsSensitivity: number;
  fov: number;
  master: number;
  sfx: number;
  music: number;
  ambient: number;
  invertY: boolean;
  bloom: boolean;
  dof: boolean;
  motionBlur: boolean;
  godrays: boolean;
  ssao: boolean;
  shadows: boolean;
  resolutionScale: number; // 0.5 - 1.5
  aiPerTeam: number; // 6 - 24
  showFps: boolean;
  hrtf: boolean;
}

export interface MatchConfig {
  mode: ModeId;
  map: MapId;
  team: 0 | 1;
  cls: ClassId;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: "high",
  sensitivity: 1,
  adsSensitivity: 0.65,
  fov: 82,
  master: 0.8,
  sfx: 1,
  music: 0.5,
  ambient: 0.8,
  invertY: false,
  bloom: true,
  dof: true,
  motionBlur: true,
  godrays: true,
  ssao: false,
  shadows: true,
  resolutionScale: 1,
  aiPerTeam: 14,
  showFps: false,
  hrtf: true,
};

export interface PointHud {
  name: string;
  owner: number; // -1 neutral
  cap: number; // -1..1 (+ = team0)
  x: number;
  z: number;
  active: boolean;
  screenX: number;
  screenY: number;
  onScreen: boolean;
  dist: number;
}

export interface WeaponHud {
  name: string;
  ammo: number;
  reserve: number;
  mag: number;
  heat: number;
  overheated: boolean;
  energy: boolean;
  reloading: number; // 0..1
  slot: number;
  slots: string[];
}

export interface KillFeedItem {
  id: number;
  killer: string;
  victim: string;
  weapon: string;
  kTeam: number;
  vTeam: number;
  headshot: boolean;
  t: number;
}

export interface MinimapEntity {
  x: number;
  z: number;
  team: number;
  player?: boolean;
}

export interface HudState {
  running: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  weapon: WeaponHud;
  grenades: number;
  tickets: [number, number];
  ticketsMax: [number, number];
  timer: number;
  points: PointHud[];
  feed: KillFeedItem[];
  hitMarker: number; // timestamp
  hitKill: boolean;
  hitHead: boolean;
  damageDirs: { a: number; t: number }[];
  yaw: number;
  mode: ModeId;
  scoped: boolean;
  ads: boolean;
  crouch: boolean;
  sprint: boolean;
  fps: number;
  kills: number;
  deaths: number;
  score: number;
  message: string;
  messageT: number;
  objective: string;
  playerTeam: number;
  respawnIn: number;
  killedBy: string;
  ended: null | { winner: number; text: string };
  minimap: MinimapEntity[];
  px: number;
  pz: number;
  worldRadius: number;
  thirdPerson: boolean;
  spawnOptions: { id: number; name: string }[];
  streak: number;
  stageText: string;
  paused: boolean;
  phase: "menu" | "deploy" | "playing" | "dead" | "ended";
  spread: number;
  time: number;
  loading: boolean;
  mapName: string;
  mapSub: string;
  suppress: number;
  dmgFlash: number;
  cls: ClassId;
}
