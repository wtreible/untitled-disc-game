// Player preferences (units live in src/units.ts). Saved per browser; changes broadcast
// 'prefschange' so a running game can apply them.
export interface Prefs {
  /** Replay each throw from a chase camera. */
  replays: boolean;
  /** Online: follow other players' throws live with the chase camera (instead of a replay after). */
  follow: boolean;
  /** Start every turn in first person (C still toggles). */
  firstPerson: boolean;
  /** First-person field of view, degrees. */
  fov: number;
  /** Flight playback speed vs real time. */
  playback: number;
  /** Show the controls help line in the HUD. */
  help: boolean;
  /** Rendering cost: pixel density and how many trees draw as full models. Physics is the same. */
  graphics: Graphics;
  /** Frame-rate readout in the corner. */
  fps: boolean;
  /** Music volume, 0–1. */
  music: number;
  /** Effects and ambience volume, 0–1. */
  sfx: number;
  /** All sound off (N, or the speaker button), volumes kept. */
  muted: boolean;
  /** Fly down each hole before its first throw. */
  flyovers: boolean;
  /** Random weather and time of day per round (off: always sunny). */
  weather: boolean;
}

export type Graphics = 'low' | 'medium' | 'high';

const KEY = 'sat-golf:prefs';
const DEFAULTS: Prefs = { replays: true, follow: true, firstPerson: true, fov: 62, playback: 1.5, help: true, graphics: 'medium', fps: false, music: 0.6, sfx: 0.8, muted: false, flyovers: true, weather: true };

let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  let p: Partial<Prefs> = {};
  try {
    p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Older builds stored only the replays flag under its own key.
    if (p.replays === undefined && localStorage.getItem('sat-golf:replays') === 'off') p.replays = false;
  } catch { /* storage unavailable */ }
  cache = { ...DEFAULTS, ...p };
  return cache;
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  cache = { ...prefs(), [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('prefschange'));
}

export function replaysOn(): boolean {
  return prefs().replays;
}
