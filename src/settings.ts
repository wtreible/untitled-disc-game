// Player preferences (units live in src/units.ts). Saved per browser; changes broadcast
// 'prefschange' so a running game can apply them.
import type { KeyAction } from './keys';
import type { ThrowStyle } from './modes/throwStyles';

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
  /** Less movement: camera cuts instead of glides, no flyovers, replays or follow cam, no UI animation. */
  reduceMotion: boolean;
  /** Playing alone: no replay, and the next throw is ready as soon as the disc stops. */
  quickSolo: boolean;
  /** First-person drag-to-look speed (× the usual), and dragging up looks down. */
  lookSpeed: number;
  invertLook: boolean;
  /** The browser asks before leaving a round in progress (closing the tab, reloading). */
  confirmLeave: boolean;
  /** Ghost disc: this browser's best tee shot on each hole flies alongside the next. */
  ghosts: boolean;
  /** After each of your throws: carry, peak height, how it moved, release speed. */
  shotInfo: boolean;
  /** Dev: how throws are input (src/modes/throwStyles.ts). */
  throwStyle: ThrowStyle;
  /** Keys changed from the defaults (src/keys.ts). */
  keys: Partial<Record<KeyAction, string>>;
}

export type Graphics = 'low' | 'medium' | 'high';

const KEY = 'untitled-disc-game:prefs';
/** The system's own "reduce motion" setting, the default for ours. */
const systemReduceMotion = (): boolean => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const DEFAULTS: Prefs = {
  replays: true, follow: true, firstPerson: true, fov: 62, playback: 1.5, help: true, graphics: 'medium', fps: false, music: 0.6, sfx: 0.8, muted: false, flyovers: true, weather: true,
  reduceMotion: false, quickSolo: false, lookSpeed: 1, invertLook: false, confirmLeave: true, ghosts: false, shotInfo: true, throwStyle: 'classic', keys: {},
};

let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  let p: Partial<Prefs> = {};
  try {
    p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch { /* storage unavailable */ }
  cache = { ...DEFAULTS, reduceMotion: systemReduceMotion(), ...p };
  return cache;
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  cache = { ...prefs(), [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('prefschange'));
}

export function replaysOn(): boolean {
  return prefs().replays && !prefs().reduceMotion;
}
/** Hole flyovers and riding along with friends' throws: both off with Reduce motion. */
export const flyoversOn = (): boolean => prefs().flyovers && !prefs().reduceMotion;
export const followOn = (): boolean => prefs().follow && !prefs().reduceMotion;
