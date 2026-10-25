// What the disc game mode (src/modes/disc.ts) shares that doesn't depend on a round: its courses,
// tuning constants, labels, sounds per cue, and small geometry helpers.
import { dist, type Vec2 } from '../course/geo';
import { BASKET, shotLaunch, type Shot, type ThrowEvent } from '../disc/flight';
import type { Disc } from '../disc/discs';
import type { Vec3 } from '../game/terrain';
import type { ViewMode } from '../render/scene';
import type { Cue } from '../audio/cues';
import { sfx, type Track } from '../audio/sound';
import type { Tone } from '../ui/broadcast';

export const DISC_COURSES = {
  simple: 'courses/tali-simple.json',
  forest: 'courses/tali.json',
  silly: 'courses/silly.json',
  fantasy: 'courses/fantasy.json',
  rainbow: 'courses/rainbow.json',
  pirate: 'courses/pirate.json',
  oakgrove: 'courses/oak-grove.json',
  bechovice: 'courses/bechovice.json',
  skatas: 'courses/skatas.json',
  kincaid: 'courses/kincaid.json',
  julkujarvi: 'courses/julkujarvi.json',
  bluelake: 'courses/blue-lake.json',
  prater: 'courses/prater.json',
  greer: 'courses/greer.json',
  graveyard: 'courses/graveyard.json',
  winter: 'courses/winter.json',
} as const;
export const VIEWS: ViewMode[] = ['photo', 'overlay', 'classes'];
/** Circle 2: inside this, switch to first-person putting. */
export const PUTT_RANGE = 20;
/** First person: launch = view pitch + this, so a level view gives a putt's gentle arc… */
export const PUTT_LAUNCH_OFFSET = 0.12;
/** …or, for throws, the disc's own best launch angle (fast discs want it flatter). */
export const launchOffset = (disc: Disc, putt: boolean, shot: Shot) => (putt ? PUTT_LAUNCH_OFFSET : shotLaunch(shot, disc));
/** The shot chip cycles through these (G). */
export const SHOTS: Shot[] = ['standard', 'tomahawk', 'thumber', 'roller'];
export const SHOT_LABELS: Record<Shot, string> = { standard: 'Normal', tomahawk: 'Tomahawk', thumber: 'Thumber', roller: 'Roller' };

/**
 * The first `frac` of a ghost path by ground distance covered, not by sample count: a high throw
 * hangs in the air and a low one rolls, so half the samples isn't half the line.
 */
export function cutByDistance(q: Vec3[], frac: number): Vec3[] {
  if (frac >= 1) return q;
  if (frac <= 0 || q.length < 2) return [];
  const seg = (i: number) => Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  let total = 0;
  for (let i = 1; i < q.length; i++) total += seg(i);
  let want = total * frac;
  for (let i = 1; i < q.length; i++) {
    const s = seg(i);
    if (s >= want) {
      const t = s > 0 ? want / s : 0, a = q[i - 1], b = q[i];
      return [...q.slice(0, i), [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]];
    }
    want -= s;
  }
  return q;
}
export const CHAIN_MID = (BASKET.trayTop + BASKET.chainTop) / 2;
/** Music per course. */
export const TRACKS: Record<keyof typeof DISC_COURSES | 'range', Track> = { simple: 'park', forest: 'park', silly: 'minigolf', fantasy: 'fantasy', rainbow: 'space', pirate: 'minigolf', oakgrove: 'park', bechovice: 'park', skatas: 'park', kincaid: 'park', julkujarvi: 'park', bluelake: 'park', prater: 'park', greer: 'park', graveyard: 'fantasy', winter: 'minigolf', range: 'park' };
/** Landing puff colors by what it landed on. */
export const PUFF: Record<string, string[]> = {
  fairway: ['#7a9a4a', '#9bb565', '#8a7a55'], rough: ['#6f8f45', '#8a7a55', '#a3b06a'], green: ['#7fb04f', '#a6c96e'],
  tee: ['#a8a39a', '#8a7a55'], trees: ['#5a4a32', '#4f7d2c', '#7a6a48'], bunker: ['#d9c08a', '#e8d3a0', '#c9ad74'],
  path: ['#a8a39a', '#8f8a80', '#bdb6aa'], oob: ['#7a9a4a', '#8a7a55'],
  rainbow: ['#ff4d6d', '#ff9f43', '#ffe066', '#5ee07a', '#4dabf7', '#9b6bff'],
};
/** Holding Shift plays flights and replays this much faster. */
export const FAST_FORWARD = 3;
/** Jingle when a hole is finished, by result. */
export const JINGLES: Record<Tone, 'jingle-great' | 'jingle-birdie' | 'jingle-par' | 'jingle-bogey'> = {
  ace: 'jingle-great', eagle: 'jingle-great', birdie: 'jingle-birdie', par: 'jingle-par', bogey: 'jingle-bogey', double: 'jingle-bogey', info: 'jingle-par', hot: 'jingle-par',
};

/** Play one of a throw's sound cues. */
export function playCue(c: Cue, gain: number): void {
  switch (c.sound) {
    case 'tree': sfx('tree', { gain }); sfx('leaves', { gain: gain * 0.5 }); break;
    case 'branch': sfx('branch', { gain: gain * 0.6 }); sfx('leaves', { gain: gain * 0.8 }); break;
    case 'bonk': sfx('bonk', { gain }); break;
    case 'chains':
      // Into the chains, then the disc dropping into the tray.
      sfx('chain', { gain });
      sfx('tray', { gain: gain * 0.4, delay: 0.3 });
      break;
    case 'clank': sfx(Math.random() < 0.5 ? 'clank' : 'tray', { gain }); break;
    case 'land': sfx(c.surface === 'path' ? 'land-hard' : c.surface === 'bunker' ? 'land-sand' : 'land-grass', { gain: gain * 0.8 }); break;
    case 'splash': sfx('splash', { gain }); break;
    case 'ob': sfx('ob'); break;
    case 'mark':
      // Augments at work: most are seen, not heard.
      if (c.mark === 'skip') sfx('splash', { gain: gain * 0.6 });
      else if (c.mark === 'buddy') sfx('chain', { gain });
      else if (c.mark === 'saved' || c.mark === 'insured') sfx('confirm', { gain: gain * 0.7 });
      else if (c.mark === 'chop') sfx('tree', { gain: gain * 0.7 });
      break;
  }
}

export const LIE_LABELS: Record<string, string> = {
  tee: 'Tee pad', fairway: 'Fairway', rough: 'Open', trees: 'Woods', bunker: 'Sand', green: 'Basket', path: 'Path', water: 'Water', oob: 'OB',
};
export const EVENT_TOASTS: Partial<Record<ThrowEvent, string>> = {
  trunk: 'Tree!', branch: 'Kicked by branches', spit: 'Spit out!', cut: 'Cut through the chains', band: 'Top band!',
  tray: 'Off the cage', pole: 'Pole hit', water: 'Splash! +1', oob: 'OB! +1',
  phased: 'Phased through a tree', saved: 'Saved by Sticky Plastic', magnet: 'Magnet pull',
  skip: 'Skipped across the water!', burned: 'Fireball!', boomerang: 'Boomerang!', buddy: 'Nudged in by your basket buddy!', insured: 'Insured: no penalty',
  mando: 'Missed the mando! +1', island: 'Off the island! +1',
};

/** Position at fractional sample index t (60 Hz samples), linearly interpolated. */
export function sampleAt(s: Vec3[], t: number): Vec3 {
  const i = Math.min(Math.floor(t), s.length - 1);
  const j = Math.min(i + 1, s.length - 1);
  const a = t - Math.floor(t);
  return [s[i][0] + (s[j][0] - s[i][0]) * a, s[i][1] + (s[j][1] - s[i][1]) * a, s[i][2] + (s[j][2] - s[i][2]) * a];
}

export function closestAlong(p: Vec2, line: Vec2[]): number {
  let best = Infinity, at = 0, acc = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const L = dist(a, b) || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L)));
    const d = Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])));
    if (d < best) { best = d; at = acc + t * L; }
    acc += L;
  }
  return at;
}

export function pointAlong(line: Vec2[], s: number): Vec2 {
  for (let i = 1; i < line.length; i++) {
    const L = dist(line[i - 1], line[i]);
    if (s <= L) return [line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * s) / L, line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * s) / L];
    s -= L;
  }
  return line[line.length - 1];
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const fmtPar = (d: number) => (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d));

export function scoreWord(strokes: number, par: number): string {
  if (strokes === 1) return 'ACE!';
  const n: Record<number, string> = { [-3]: 'Albatross', [-2]: 'Eagle', [-1]: 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
  return n[strokes - par] ?? `+${strokes - par}`;
}

/** The release chip: angle and hand; overhand shots have neither (they're thrown on edge). */
export function releaseText(h: number, fh: boolean, sh: Shot): string {
  if (sh === 'tomahawk' || sh === 'thumber') return 'Overhand';
  return sh === 'roller' ? (fh ? 'Forehand' : 'Backhand') : `${releaseLabel(h)} · ${fh ? 'Forehand' : 'Backhand'}`;
}

export function releaseLabel(h: number): string {
  if (h === 0) return 'Flat';
  const deg = Math.round(Math.abs(h) * 20);
  return `${h > 0 ? 'Hyzer' : 'Anhyzer'} ${deg}°`;
}

/**
 * Wind for a new hole: 30% calm (0–1 m/s), 50% breezy (1–3), 20% windy (3–5), any direction.
 * Capped at 5 m/s: a tailwind already costs a distance driver ~15% and turns a headwind drive over.
 */
export function drawWind(): Vec2 {
  const r = Math.random();
  const speed = r < 0.3 ? Math.random() : r < 0.8 ? 1 + Math.random() * 2 : 3 + Math.random() * 2;
  const a = Math.random() * Math.PI * 2;
  return [Math.cos(a) * speed, Math.sin(a) * speed];
}

/**
 * The meter's fill `ms` into a charge: up to full, back down, and round again, at `speed` sweeps a
 * second. The thrower's and every watcher's meter run from this, so only the start is sent.
 */
export function meterAt(ms: number, speed: number): number {
  const t = ((ms / 1000) * speed) % 2;
  return t < 1 ? t : 2 - t;
}
