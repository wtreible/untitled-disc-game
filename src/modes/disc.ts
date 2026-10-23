// Disc golf mode (default): a round at an OSM-mapped course with real tree canopy, local hot-seat.
import { LocalFrame, dist, distToPolyline, polylineLength, type Vec2 } from '../course/geo';
import { simplify } from '../course/disc-build';
import { decodeTrees, type DiscCourseFile, type Tree } from '../course/disc-types';
import { DISCS, PUTTER_DISC, suggestDisc, type Disc } from '../disc/discs';
import { BASKET, shotLaunch, simulateThrow, type DiscWorld, type Shot, type ThrowEvent, type ThrowInput, type ThrowResult } from '../disc/flight';
import { TreeIndex } from '../disc/trees';
import { effectiveMods } from '../disc/mods';
import { PLACE_TEXT, place, pondsFor, teeFor, treesFor } from '../rogue/course';
import { byId, drawOffer, rollTier, type Tier } from '../rogue/powerups';
import { cleanRules, tierWeights, type CrazyRules } from '../rogue/rules';
import { chipFor, openAugmentBrowser, renderSidePanel, stacked } from '../ui/augments';
import { CATEGORIES } from '../rogue/powerups';
import { playerColors } from '../game/game';
import { DiscRound, type RoundEvent, type WireResult } from './discRound';
import { roundStats, type ShotRef } from './roundStats';
import type { RoomClient } from '../net/room';
import { SurfaceGrid } from '../game/surfaces';
import { FlatTerrain, type Vec3 } from '../game/terrain';
import { CourseScene } from '../render/courseScene';
import { loadProps } from '../render/props';
import { treeShape } from '../disc/treeShapes';
import { discCard, mountDiscPicker } from '../ui/discPicker';
import { IMAGERY, asset } from '../assets';
import { VIEW_LABELS, type ViewMode } from '../render/scene';
import { ESRI_ATTRIBUTION, loadImagery } from '../render/tiles';
import { convertText, fmtLen, fmtSpeed } from '../units';
import { prefs, replaysOn } from '../settings';
import { banner, chip, clearBroadcast, scoreTone, type Tone } from '../ui/broadcast';
import { throwCues, type Cue } from '../audio/cues';
import { ambience, music, preload, rain, sfx, wind, type Track } from '../audio/sound';
import { Gallery } from '../render/gallery';
import { Effects } from '../render/effects';
import { Life } from '../render/life';
import { WEATHER, pickWeather, type Weather } from '../render/weather';
import { setTreeWind } from '../render/disc3d';
import { commentary } from '../ui/commentary';
import { CHAT_LINES, mountQuickChat, showChat } from '../ui/quickChat';
import { FT, rangeConditions, rangeCourse, rangeTree, rangeWind } from '../course/range';
import { rangeMarkers } from '../render/rangeMarkers';
import { freshRange, loadRange, mountRangePanel, saveRange, type RangeTool } from '../ui/rangePanel';

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
} as const;
const VIEWS: ViewMode[] = ['photo', 'overlay', 'classes'];
/** Circle 2: inside this, switch to first-person putting. */
const PUTT_RANGE = 20;
/** First person: launch = view pitch + this, so a level view gives a putt's gentle arc… */
const PUTT_LAUNCH_OFFSET = 0.12;
/** …or, for throws, the disc's own best launch angle (fast discs want it flatter). */
const launchOffset = (disc: Disc, putt: boolean, shot: Shot) => (putt ? PUTT_LAUNCH_OFFSET : shotLaunch(shot, disc));
/** The shot chip cycles through these (G). */
const SHOTS: Shot[] = ['standard', 'tomahawk', 'thumber', 'roller'];
const SHOT_LABELS: Record<Shot, string> = { standard: 'Normal', tomahawk: 'Tomahawk', thumber: 'Thumber', roller: 'Roller' };

/**
 * The first `frac` of a ghost path by ground distance covered, not by sample count: a high throw
 * hangs in the air and a low one rolls, so half the samples isn't half the line.
 */
function cutByDistance(q: Vec3[], frac: number): Vec3[] {
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
const CHAIN_MID = (BASKET.trayTop + BASKET.chainTop) / 2;
/** Music per course. */
const TRACKS: Record<DiscOptions['course'], Track> = { simple: 'park', forest: 'park', silly: 'minigolf', fantasy: 'fantasy', rainbow: 'space', pirate: 'minigolf', oakgrove: 'park', bechovice: 'park', skatas: 'park', kincaid: 'park', julkujarvi: 'park', bluelake: 'park', range: 'park' };
/** Landing puff colors by what it landed on. */
const PUFF: Record<string, string[]> = {
  fairway: ['#7a9a4a', '#9bb565', '#8a7a55'], rough: ['#6f8f45', '#8a7a55', '#a3b06a'], green: ['#7fb04f', '#a6c96e'],
  tee: ['#a8a39a', '#8a7a55'], trees: ['#5a4a32', '#4f7d2c', '#7a6a48'], bunker: ['#d9c08a', '#e8d3a0', '#c9ad74'],
  path: ['#a8a39a', '#8f8a80', '#bdb6aa'], oob: ['#7a9a4a', '#8a7a55'],
  rainbow: ['#ff4d6d', '#ff9f43', '#ffe066', '#5ee07a', '#4dabf7', '#9b6bff'],
};
/** Holding Shift plays flights and replays this much faster. */
const FAST_FORWARD = 3;
/** Jingle when a hole is finished, by result. */
const JINGLES: Record<Tone, 'jingle-great' | 'jingle-birdie' | 'jingle-par' | 'jingle-bogey'> = {
  ace: 'jingle-great', eagle: 'jingle-great', birdie: 'jingle-birdie', par: 'jingle-par', bogey: 'jingle-bogey', double: 'jingle-bogey', info: 'jingle-par', hot: 'jingle-par',
};

/** Play one of a throw's sound cues. */
function playCue(c: Cue, gain: number): void {
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
  }
}

const LIE_LABELS: Record<string, string> = {
  tee: 'Tee pad', fairway: 'Fairway', rough: 'Open', trees: 'Woods', bunker: 'Sand', green: 'Basket', path: 'Path', water: 'Water', oob: 'OB',
};
const EVENT_TOASTS: Partial<Record<ThrowEvent, string>> = {
  trunk: 'Tree!', branch: 'Kicked by branches', spit: 'Spit out!', cut: 'Cut through the chains', band: 'Top band!',
  tray: 'Off the cage', pole: 'Pole hit', water: 'Splash! +1', oob: 'OB! +1',
  phased: 'Phased through a tree', saved: 'Saved by Sticky Plastic', magnet: 'Magnet pull',
};

/** Position at fractional sample index t (60 Hz samples), linearly interpolated. */
function sampleAt(s: Vec3[], t: number): Vec3 {
  const i = Math.min(Math.floor(t), s.length - 1);
  const j = Math.min(i + 1, s.length - 1);
  const a = t - Math.floor(t);
  return [s[i][0] + (s[j][0] - s[i][0]) * a, s[i][1] + (s[j][1] - s[i][1]) * a, s[i][2] + (s[j][2] - s[i][2]) * a];
}

function closestAlong(p: Vec2, line: Vec2[]): number {
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

function pointAlong(line: Vec2[], s: number): Vec2 {
  for (let i = 1; i < line.length; i++) {
    const L = dist(line[i - 1], line[i]);
    if (s <= L) return [line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * s) / L, line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * s) / L];
    s -= L;
  }
  return line[line.length - 1];
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtPar = (d: number) => (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d));

/** idle: between steps; watching: another player's turn (online). */
type Phase = 'aim' | 'charging' | 'flying' | 'replay' | 'between' | 'placing' | 'watching' | 'idle';

export interface DiscOptions {
  names: string[];
  /** 'range': the driving range (src/course/range.ts): everyone throws from the tee in turn, nothing scored. */
  course: keyof typeof DISC_COURSES | 'range';
  /** First hole index and number of holes. */
  first: number;
  count: number;
  /** Roguelike run: draft a powerup after every hole. */
  rogue?: boolean;
  /** Online: the room, which players this browser controls, and the log so far. */
  net?: NetPlay;
  /** Crazy mode setup (the host's is the one used). */
  rules?: CrazyRules;
  /** Bag building: everyone picks the discs they carry before hole 1. */
  bag?: boolean;
  /** Each player's picked color (missing or taken ones get a default). */
  colors?: string[];
}

/** The thrower's aim, streamed to the others while they line up a throw (not part of the log). */
interface LiveAim {
  player: number;
  yaw: number;
  pitch: number;
  target: Vec2;
  disc: string;
  hyzer: number;
  forehand: boolean;
  shot?: Shot;
  fp: boolean;
  /** Meter fill while charging, else 0. */
  power: number;
}

export interface NetPlay {
  room: RoomClient;
  isHost: boolean;
  mine: (player: number) => boolean;
  log: { seq: number; from: string; e: RoundEvent }[];
  /** Each player's browser (client id), and who was connected at the start. */
  seats: string[];
  present: string[];
}

export async function startDisc(opts: DiscOptions): Promise<void> {
  const range = opts.course === 'range';
  const course: DiscCourseFile = opts.course === 'range' ? rangeCourse() : await (await fetch(asset(DISC_COURSES[opts.course]))).json();
  const trees = decodeTrees(course.trees);
  const frame = new LocalFrame(course.origin);
  const grid = SurfaceGrid.fromHole({
    bounds: course.bounds, boundary: course.boundary, features: course.features, ob: course.ob, sea: course.sea,
    trees: course.canopy.map((c, i) => ({ osm_id: `canopy/${i}`, rings: c.rings, height_m: c.height_m })),
  }, 0.5);
  const blocked = (q: Vec2) => { const c = grid.classAt(q[0], q[1]); return c === 'oob' || c === 'water'; };
  // Everything the players share lives in the round state and changes only through events
  // (src/modes/discRound.ts). This file presents it and turns input into events.
  const rogue = !!opts.rogue && !range;
  /** Each player's color, as picked on the menu (or the defaults). */
  const COLORS = playerColors(opts.names.map((_, i) => opts.colors?.[i]));
  const st = new DiscRound(course.holes, trees, { names: opts.names, first: opts.first, count: opts.count, rogue, bag: !!opts.bag && !range, range, colors: COLORS }, blocked);
  const { round, mods, owned, mulligansLeft, perfectLeft } = st;
  const net = opts.net ?? null;
  /** Away players the host is playing for until they reconnect (online). */
  const covering = new Set<number>();
  /** Players this browser controls (all of them in hot seat, and anyone the host covers). */
  const mine = (p: number) => !net || net.mine(p) || covering.has(p);
  const isHost = !net || net.isHost;
  /** Events this browser knows of, ours and the room's: the next one's log position. */
  let known = net ? net.log.length : 0;
  const sent = new Map<number, RoundEvent>();
  /** Other players' events waiting their turn (one arriving mid-flight waits for the landing). */
  const inbox: RoundEvent[] = [];
  /**
   * Apply one of our events and send it to the room. It goes through JSON first, exactly as
   * another player's arrives, so everyone applies the same thing.
   */
  function commit(e: RoundEvent): void {
    if (inbox.length) return resync(); // someone else's event got in first: start over from the room's log
    st.apply(JSON.parse(JSON.stringify(e)) as RoundEvent);
    if (net) { sent.set(known, e); net.room.sendEvent(known, e); }
    known++;
  }
  /**
   * Online, our throw goes to the room the moment it's released, so everyone watches it fly at
   * the same time. Like everyone else, we apply it when it lands.
   */
  function sendNow(e: RoundEvent): boolean {
    if (!net) return false;
    if (inbox.length) { resync(); return false; }
    sent.set(known, e);
    net.room.sendEvent(known, e);
    known++;
    return true;
  }
  /** Commit, then show it and move the round on. */
  function dispatch(e: RoundEvent): void {
    commit(e);
    react(e);
  }
  /** Commit without moving on (a draft offer is part of the draft step). */
  const dispatchQuiet = commit;
  let perfectArmed = false; // local: arming Perfect Form for the next throw
  /** Range: each player's last aim, disc and release, kept for their next throw. */
  const kept = new Map<number, { aimTarget: Vec2; yaw: number; pitch: number; disc: Disc; hyzer: number; forehand: boolean; shot: Shot }>();
  // Themed props: colliders for physics; hit toasts by collider tag.
  const propColliders = (course.props ?? []).flatMap((p) => p.colliders);
  const propToasts = new Map<string, string>([['blades', 'Swatted by the windmill!']]);
  for (const p of course.props ?? []) for (const c of p.colliders) if (c.tag && p.hit && !propToasts.has(c.tag)) propToasts.set(c.tag, p.hit);
  /**
   * Game clock (s) for moving props. It advances with flight playback speed, so the blades you
   * see match the physics (which evaluates them at release clock + flight time).
   */
  let gameClock = 0;
  const worldCache = new Map<number, { v: number; w: DiscWorld }>();
  // Course trees are branched models (trunk + leaf clumps); themed courses' model trees keep theirs.
  const propTrees = new Set((course.props ?? []).filter((p) => p.tree !== undefined).map((p) => trees[p.tree!]));
  const shapeOf = (t: Tree) => (propTrees.has(t) ? null : treeShape(t, course.tree_models));
  /** The course as player i plays it: their trees, their ponds, their basket. */
  const worldFor = (i: number): DiscWorld => {
    const c = worldCache.get(i);
    const pin = round.game.pins[i];
    if (c && c.v === st.version && c.w.basket === pin) return c.w;
    const w: DiscWorld = {
      grid, terrain: new FlatTerrain(), basket: pin, branchDensity: course.branch_density,
      trees: new TreeIndex(treesFor(trees, st.removed, st.changes, i)), hazards: pondsFor(st.changes, i),
      props: propColliders, clock0: gameClock, treeShape: shapeOf,
    };
    worldCache.set(i, { v: st.version, w });
    return w;
  };
  /** World for the current player, with moving props evaluated from the game clock now. */
  const world = (): DiscWorld => {
    if (range) {
      const pin = myPin();
      return {
        grid, terrain: new FlatTerrain(), basket: pin, extraBaskets: R().baskets.filter((b) => b !== pin), branchDensity: course.branch_density,
        trees: rangeTrees, props: [], clock0: gameClock, treeShape: shapeOf, wind: st.wind,
      };
    }
    const w = worldFor(round.game.current); w.clock0 = gameClock; w.wind = windFor(round.game.current); return w;
  };
  /**
   * The hole's wind as player i plays it: Personal Tailwind turns it toward their basket. (How
   * strongly it moves their disc, windScale, is applied by the flight model.)
   */
  function windFor(i: number): Vec2 {
    const w = st.wind;
    if (!modsFor(i).tailwind) return w;
    const sp = Math.hypot(w[0], w[1]), b = round.game.players[i].ball, pin = round.game.pins[i];
    const a = Math.atan2(pin[1] - b[1], pin[0] - b[0]);
    return [Math.cos(a) * sp, Math.sin(a) * sp];
  }
  /** Mods acting on player i's throws: their own plus opponents' hexes. */
  const modsFor = (i: number) => effectiveMods(mods, i);
  const hole = () => st.hole;

  // ---------- driving range: baskets and trees placed at will, wind and weather picked ----------
  /** This browser's copy (the panel edits it, saved here); the round's own is st.range. */
  const rs = loadRange();
  /** The range everyone plays: the round's, or ours until the round has one. */
  const R = () => st.range ?? rs;
  let rangeTrees = new TreeIndex(rs.trees);
  /** No basket on the range: the flight model still wants one, so it's far behind the tee. */
  const NO_BASKET: Vec2 = [0, -1e4];
  /** The range basket nearest where the thrower is aiming. */
  const rangePin = (): Vec2 | null => R().baskets.reduce<Vec2 | null>((a, b) => (!a || dist(b, aimTarget) < dist(a, aimTarget) ? b : a), null);

  // Expected full-power flat range per disc, for disc suggestions.
  const ranges = Object.fromEntries(DISCS.map((d) => {
    const r = simulateThrow({ start: [0, 0], aim: 0, power: 1, disc: d, hyzer: 0 }, { ...worldFor(round.game.current), basket: [1e6, 1e6], wind: undefined }, () => 0.25, { ghost: true });
    return [d.id, dist([0, 0], r.rest)];
  }));

  const scene = new CourseScene($('stage'), course, grid, trees, COLORS);
  if (range) { scene.addObject(rangeMarkers()); scene.setBaskets(rs.baskets); }
  music(TRACKS[opts.course]);
  const space = opts.course === 'rainbow';
  // Spectators stand on open ground: not in water or OB, clear of trunks and props.
  let nearTrees: Tree[] = [];
  const free = (p: Vec2) => {
    const c = grid.classAt(p[0], p[1]);
    if (c === 'oob' || c === 'water') return false;
    if (nearTrees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < Math.max(0.8, t.t + 0.7))) return false;
    return !propColliders.some((k) => (k.kind === 'cyl' && Math.hypot(k.c[0] - p[0], k.c[1] - p[1]) < k.r + 0.6)
      || (k.kind === 'box' && Math.abs((p[0] - k.c[0]) * Math.cos(k.yaw) + (p[1] - k.c[1]) * Math.sin(k.yaw)) < k.hx + 0.6
        && Math.abs(-(p[0] - k.c[0]) * Math.sin(k.yaw) + (p[1] - k.c[1]) * Math.cos(k.yaw)) < k.hy + 0.6));
  };
  const gallery = new Gallery(free);
  const effects = new Effects();
  const life = new Life(course.bounds, space);
  for (const g of [gallery.group, effects.group, life.group]) scene.addObject(g);
  /** The round's weather: from the first hole's wind, which every player in a room shares. */
  let roundWeather: Weather | null = null;
  function applyWeather(): void {
    if (space) { ambience('space'); return; }
    if (range) roundWeather = WEATHER[R().weather];
    const first = st.log.find((e): e is Extract<RoundEvent, { t: 'hole-start' }> => e.t === 'hole-start');
    if (!first) { ambience('outdoors'); return; }
    roundWeather ??= pickWeather(first.wind[0] * 7.31 + first.wind[1] * 3.17);
    const w = prefs().weather || range ? roundWeather : WEATHER.clear;
    scene.setWeather(w);
    life.setWeather(w);
    rain(w.rain);
    ambience(w.rain ? null : 'outdoors');
  }
  window.addEventListener('prefschange', applyWeather);
  preload(['swish', 'tree', 'branch', 'leaves', 'bonk', 'chain', 'clank', 'tray', 'land-grass', 'splash', 'ob']);
  if (new URLSearchParams(location.search).get('debug') === 'colliders') scene.showColliders(propColliders);
  if (course.props?.length) {
    $('status').textContent = 'Loading models…';
    loadProps(course.props, trees)
      .then((v) => { scene.attachProps(v); $('status').textContent = ''; })
      .catch((e) => { $('status').textContent = `Models failed to load (${e.message})`; });
  }
  const vector = scene.style === 'vector';
  $('view-toggle').hidden = vector; // one look in vector style
  if (vector) {
    $('attribution').textContent = course.source.attribution.join(' · ');
  } else if (!IMAGERY) {
    // Public build without imagery rights: the drawn surface classes instead of the photo.
    $('attribution').textContent = course.source.attribution.join(' · ');
    $('view-toggle').hidden = true;
    scene.setView('classes');
  } else {
    $('attribution').textContent = [ESRI_ATTRIBUTION, ...course.source.attribution].join(' · ');
    $('status').textContent = 'Loading imagery…';
    const maxTex = Math.min(8192, scene.renderer.capabilities.maxTextureSize);
    loadImagery(frame, course.bounds, 19, maxTex)
      .then((img) => {
        scene.setImagery(img, course.imagery_offset_m);
        $('status').textContent = img.failedTiles ? `${img.failedTiles} imagery tiles failed to load` : '';
      })
      .catch((e) => { $('status').textContent = `Imagery unavailable (${e.message}); showing classes`; });
  }

  // ---------- turn state ----------
  let phase: Phase = 'aim';
  let disc: Disc = DISCS[0];
  let hyzer = 0; // -1..1 in quarter steps
  let forehand = false;
  /** The kind of throw: normal, overhand (tomahawk / thumber) or roller. Back to normal each throw. */
  let shot: Shot = 'standard';
  let aimTarget: Vec2 = hole().pin;
  let yaw = 0;
  let pitch = 0;
  let power = 0;
  let chargeStart = 0;
  let preferFP = prefs().firstPerson; // C switches (persists across turns)
  let fpOverride: boolean | null = null; // inside putting range, C overrides auto first person for this turn
  /** A throw being shown (local or, later, another player's): the event is applied when it lands. */
  /** The throw in the air. `show`: a highlight replayed from the final card (already applied). */
  /** `cues`: its sounds (src/audio/cues.ts), `cue` the next one to play (back to 0 for the replay). */
  /** `t`: samples flown so far (advanced each frame, faster while fast-forwarding). */
  let flight: { e: Extract<RoundEvent, { t: 'throw' }>; result: WireResult; t: number; speed: number; clock0: number; remote: boolean; sentEarly: boolean; show?: boolean; cues: Cue[]; cue: number } | null = null;
  /** Online: the current thrower's aim, as they last sent it (another player's turn only). */
  let liveAim: LiveAim | null = null;
  /** Post-throw replay from a disc-chasing camera (skippable). */
  let replay: { t: number; heading: number; smoothHeading: number; started: boolean; last: number } | null = null;
  const REPLAY_SPEED = 1.25;
  const REPLAY_MIN_SAMPLES = 40; // skip tap-ins and tiny putts
  let tick = 0; // meter tick (power to reach target)

  const game = () => round.game;
  const player = () => game().player;
  const pinOf = (i: number) => game().pins[i];
  const myPin = () => (range ? rangePin() ?? NO_BASKET : pinOf(game().current));
  const toBasket = () => dist(player().ball, myPin());
  const autoFP = () => toBasket() <= PUTT_RANGE && player().strokes > 0;
  const isFP = () => fpOverride ?? (preferFP || autoFP());
  const puttStyle = () => isFP() && disc === PUTTER_DISC && toBasket() <= PUTT_RANGE + 5;

  function startHoleInfo(): void {
    const h = hole();
    $('hole-info').innerHTML = `<div class="num">${esc(h.ref)}<small>${range ? 'RANGE' : 'HOLE'}</small></div><div class="info">
      <div class="hname">${esc(h.name ?? course.name)}</div>
      <div class="hmeta">${range ? 'Practice · lines every 50 ft' : `Par ${h.par}${h.par_source === 'length' ? '<span title="No par in OSM; estimated from length">*</span>' : ''} · ${fmtLen(h.length_m)}`}</div>
      ${h.name ? `<div class="course">${esc(course.name)}${rogue ? ' · Crazy mode' : ''}</div>` : rogue ? '<div class="course">Crazy mode</div>' : ''}</div>
      <div class="wind" title="Wind at 10 m (weaker near the ground). The arrow shows where it blows, turned to your view."><svg viewBox="-12 -12 24 24" width="26" height="26"><path d="M0 -10 L6 2 L1.5 0.5 L1.5 10 L-1.5 10 L-1.5 0.5 L-6 2 Z" fill="currentColor"/></svg>
        <b></b><small>WIND</small></div>`;
    lastWindRot = NaN;
    lastWindLabel = '';
  }

  /**
   * Wind for a new hole: 30% calm (0–1 m/s), 50% breezy (1–3), 20% windy (3–5), any direction.
   * Capped at 5 m/s: a tailwind already costs a distance driver ~15% and turns a headwind drive over.
   */
  function drawWind(): Vec2 {
    const r = Math.random();
    const speed = r < 0.3 ? Math.random() : r < 0.8 ? 1 + Math.random() * 2 : 3 + Math.random() * 2;
    const a = Math.random() * Math.PI * 2;
    return [Math.cos(a) * speed, Math.sin(a) * speed];
  }

  /** Point the HUD wind arrow relative to the current view (up the screen = straight ahead). */
  let lastWindRot = NaN;
  let lastWindLabel = '';
  function updateWindArrow(): void {
    const el = $('hole-info').querySelector<SVGElement>('.wind svg');
    if (!el) return;
    // The current player's wind: turned by Personal Tailwind, scaled by Wind Cheater, Crosswind…
    const i = round.game.current;
    const wind = windFor(i);
    const speed = Math.hypot(wind[0], wind[1]) * modsFor(i).windScale;
    const rot = Math.round((((scene.viewHeading() - Math.atan2(wind[1], wind[0])) * 180) / Math.PI) % 360);
    const label = speed < 0.5 ? 'Calm' : fmtSpeed(speed);
    if (rot === lastWindRot && label === lastWindLabel) return;
    lastWindRot = rot;
    lastWindLabel = label;
    el.style.transform = `rotate(${rot}deg)`;
    el.parentElement!.classList.toggle('calm', speed < 0.5);
    el.parentElement!.querySelector('b')!.textContent = label;
  }

  // ---------- events from the room ----------
  /** After an event is applied (ours or theirs): show it, then do what the round needs next. */
  function react(e: RoundEvent): void {
    if (e.t === 'throw') return; // finishThrow shows it, and moves on after a pause
    if (e.t === 'range') return presentRange(); // mid-turn: the thrower carries on aiming
    if (e.t === 'hole-start') presentHole();
    if (e.t === 'mulligan') presentMulligan();
    if (e.t === 'place') { if (e.target !== undefined) refreshViewer(e.player); showPlacementPreview(e.player); }
    advance();
  }

  /** Another player's event, in log order. Their throw flies here before it's applied. */
  function receive(e: RoundEvent): void {
    if (e.t === 'throw') return playThrow(e, e.result.samples.length < 150 ? 1 : prefs().playback, true);
    st.apply(e);
    react(e);
  }

  let pumping = false;
  /** Take waiting events while nothing is in the air (a mulligan may land during the pause). */
  function pump(): void {
    if (pumping) return;
    pumping = true;
    try {
      while (inbox.length) {
        const busy = phase === 'flying' || phase === 'replay' || phase === 'charging' || (phase === 'between' && inbox[0].t !== 'mulligan');
        if (busy) break;
        receive(inbox.shift()!);
      }
    } finally {
      pumping = false;
    }
  }

  /** Our copy has diverged from the room's: reload, which rejoins and replays the room's log. */
  function resync(): void {
    $('status').textContent = 'Out of step with the room: rejoining…';
    setTimeout(() => location.reload(), 600);
  }

  function showWait(text: string): void {
    $('wait-bar').textContent = text;
    $('wait-bar').hidden = false;
  }
  function hideWait(): void {
    $('wait-bar').hidden = true;
  }

  // ---------- Crazy mode side panel: the current player's augments ----------
  let augKey = '';
  function updateAugPanel(): void {
    const el = $('aug-panel');
    const show = rogue && !$('hud').hidden && $('results').hidden && $('draft').hidden;
    if (!show) { el.hidden = true; return; }
    const i = game().current;
    const hexes = owned.flatMap((ids, k) => (k === i ? [] : ids.filter((id) => byId(id)?.kind === 'hex').map((id) => ({ id, by: opts.names[k] }))));
    const key = JSON.stringify([i, owned[i], hexes]);
    if (key !== augKey || el.hidden) {
      augKey = key;
      renderSidePanel(el, { name: opts.names[i], color: COLORS[i] }, owned[i], hexes);
    }
  }
  $('pause-augments').hidden = !rogue;
  $('pause-augments').addEventListener('click', () => {
    $('settings').hidden = true;
    openAugmentBrowser(opts.names.map((name, i) => ({ name, owned: owned[i] })));
  });

  // ---------- live aim (online): what the thrower is doing, before they throw ----------
  let lastLive = '';
  let lastLiveAt = 0;
  /** Ours, while aiming or charging: on change, at most ~10 per second. */
  function sendLiveAim(now: number): void {
    if (!net || (phase !== 'aim' && phase !== 'charging') || !mine(game().current)) return;
    const a: LiveAim = {
      player: game().current, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), target: [+aimTarget[0].toFixed(2), +aimTarget[1].toFixed(2)],
      disc: disc.id, hyzer, forehand, shot, fp: isFP(), power: phase === 'charging' ? +power.toFixed(2) : 0,
    };
    const key = JSON.stringify(a);
    if (key === lastLive || now - lastLiveAt < 100) return;
    lastLive = key;
    lastLiveAt = now;
    net.room.sendLive(a);
  }

  /** Theirs: their aim line and target, their disc and release angle, their meter, their view. */
  function showLiveAim(): void {
    const a = liveAim;
    if (!a) return;
    const p = player();
    scene.setAim(p.ball, a.target, p.color);
    scene.setTarget3d(isFP() ? p.ball : null, a.target, p.color);
    if (isFP()) scene.setEye(p.ball, a.yaw, a.pitch);
    const d = DISCS.find((x) => x.id === a.disc);
    if (d) picker.update(d, a.forehand);
    $('release').textContent = releaseText(a.hyzer, a.forehand, a.shot ?? 'standard');
    $('shot').textContent = SHOT_LABELS[a.shot ?? 'standard'];
    $('meter-fill').style.width = `${a.power * 100}%`;
  }

  // ---------- away players (online) ----------
  // If whoever the round is waiting on drops out, the host can play for them (throws, picks,
  // placements). They get their seat back as soon as they reconnect.
  const present = new Set(net?.present ?? []);
  const here = (p: number) => !net || present.has(net.seats[p] ?? '');
  /** How long someone must be gone before the host is offered their turn (a refresh is quicker). */
  const AWAY_MS = 4000;
  let awayFrom: { p: number; at: number } | null = null;
  function waitingOn(): number | null {
    if (st.stage === 'playing') return game().current;
    if (st.stage === 'drafting') return st.drafting[0] ?? null;
    if (st.stage === 'placing') return st.placing[0]?.player ?? null;
    return null;
  }
  function updateAway(): void {
    if (!net) return;
    const p = waitingOn();
    const busy = phase === 'flying' || phase === 'replay' || phase === 'charging' || phase === 'between';
    const away = p !== null && !mine(p) && !here(p) && !busy;
    if (!away) { awayFrom = null; $('away-bar').hidden = true; return; }
    if (awayFrom?.p !== p) awayFrom = { p, at: performance.now() };
    if (performance.now() - awayFrom.at < AWAY_MS) return;
    $('away-text').textContent = isHost ? `${opts.names[p]} has disconnected.` : `${opts.names[p]} has disconnected: the host can play for them.`;
    $('away-cover').hidden = !isHost;
    $('away-cover').textContent = `Play for ${opts.names[p]}`;
    $('away-bar').hidden = false;
  }
  $('away-cover').addEventListener('click', () => {
    const p = waitingOn();
    if (!isHost || p === null || here(p)) return;
    covering.add(p);
    $('away-bar').hidden = true;
    chip(`Playing for ${opts.names[p]} until they're back`, 'info');
    advance();
  });
  /** The room's member list changed: hand covered players back as they return. */
  function membersChanged(clients: string[]): void {
    present.clear();
    for (const c of clients) present.add(c);
    let back = false;
    for (const p of [...covering]) if (here(p)) { covering.delete(p); back = true; chip(`${opts.names[p]} is back`, 'info'); }
    // Mid-aim (not mid-throw) for someone who just came back: their turn again.
    const p = waitingOn();
    if (back && p !== null && !mine(p) && (phase === 'aim' || st.stage !== 'playing')) { phase = 'idle'; advance(); }
    updateAway();
  }
  if (net) window.setInterval(updateAway, 1000);

  // ---------- flow: the round's stage decides what happens next ----------
  /**
   * Do whatever the round is waiting for: our draft, placement or throw, or (when it's someone
   * else's) wait for their event. Called after every event and when a pause ends. In hot seat
   * every player is ours, so this just runs the game.
   */
  function advance(): void {
    hideWait();
    if (st.stage !== 'placing') { $('place-bar').hidden = true; scene.setPlacementPreview(null); }
    if (st.stage !== 'drafting') $('draft').hidden = true;
    if (st.stage !== 'bagging') $('bag').hidden = true;
    switch (st.stage) {
      case 'need-rules':
        if (isHost) dispatch({ t: 'rules', rules: cleanRules(opts.rules) });
        else { $('hud').hidden = true; showWait('Waiting for the host…'); }
        break;
      case 'drafting': draftStep(); break;
      case 'need-hole':
        if (isHost) startHole();
        else { $('hud').hidden = true; showWait('Waiting for the host to start the next hole'); }
        break;
      case 'placing': placeStep(); break;
      case 'playing': startTurn(); break;
      case 'card': showCard(); break;
      case 'bagging': bagStep(); break;
    }
    pump();
  }

  /** Start the next hole (the first, the first time): its wind travels in the event. */
  function startHole(): void {
    // The range: the host's saved setup is everyone's to start with.
    if (range) dispatchQuiet({ t: 'range', setup: rangeConditions(rs) });
    dispatch({ t: 'hole-start', wind: range ? rangeWind(rs) : drawWind() });
  }

  /** A hole has started (ours or the host's event): set the scene for it. */
  function presentHole(): void {
    $('results').hidden = true;
    scene.setHole(hole());
    scene.clearTrails();
    startHoleInfo();
    wind(Math.hypot(st.wind[0], st.wind[1]));
    applyWeather();
    if (range) presentRange();
    const h = hole();
    setTreeWind(st.wind);
    life.setHole(h, st.wind);
    // Spectators by the basket, out of the way of throws coming in along the hole line.
    const back = h.routing.length > 1 ? pointAlong(h.routing, Math.max(0, polylineLength(h.routing) - 30)) : h.tee;
    const L = dist(back, h.pin) || 1;
    nearTrees = trees.filter((t) => Math.hypot(t.x - h.pin[0], t.y - h.pin[1]) < 25);
    if (!range) void gallery.setHole(h.pin, [(h.pin[0] - back[0]) / L, (h.pin[1] - back[1]) / L], prefs().graphics === 'low' ? 3 : 6);
    // Every hole starts backhand; startTurn resets the release angle and picks the suggested disc.
    forehand = false;
  }

  /** Show the course as player i plays it. */
  function refreshViewer(i: number): void {
    if (range) {
      const pin = rangePin() ?? hole().tee;
      scene.setViewer({ trees: new Set(), extras: R().trees, ponds: [], basketScale: 1, magnet: 0, tee: hole().tee, pin });
      life.setHole({ tee: hole().tee, pin: rangePin() ?? NO_BASKET }, st.wind);
      return;
    }
    const m = modsFor(i);
    const visible = new Set(treesFor(trees, st.removed, { ...st.changes, trees: [] }, i));
    scene.setViewer({
      trees: visible,
      extras: st.changes.trees.filter((t) => t.owner !== i).map((t) => t.tree),
      ponds: pondsFor(st.changes, i),
      basketScale: m.basketScale, magnet: m.magnet,
      tee: teeFor(hole(), mods, i, blocked), pin: pinOf(i),
      fx: { magnet: m.magnet > 0, blackHole: owned[i].includes('black-hole'), gimme: m.gimme, phase: m.phaseTrees === Infinity },
    });
    scene.setStumps([...st.removed]);
    life.setPin(pinOf(i));
    opts.names.forEach((_, k) => scene.setDiscGold(k, owned[k].includes('golden-arm')));
  }

  // ---------- placement (Crazy mode, before each hole) ----------
  function placeStep(): void {
    const step = st.placing[0];
    phase = 'placing';
    $('hud').hidden = true;
    // Top-down over the hole, as the placer sees it.
    scene.setFirstPerson(false);
    $('reticle').hidden = true;
    $('minimap').hidden = true;
    refreshViewer(step.player);
    scene.frame([hole().tee, hole().pin, ...hole().routing], 90, 12);
    showPlacementPreview(step.player);
    if (!mine(step.player)) {
      $('place-bar').hidden = true;
      showWait(`${opts.names[step.player]} is placing a ${step.kind === 'clear-cut' ? 'Clear-Cut' : 'hex'}`);
      return;
    }
    const left = st.placing.filter((q) => q.player === step.player && q.kind === step.kind).length;
    $('place-text').innerHTML = `<span style="color:${COLORS[step.player]}">●</span> <b>${esc(opts.names[step.player])}</b>: ${convertText(PLACE_TEXT[step.kind])} <small>(${left} left; click the map)</small>`;
    $('place-bar').hidden = false;
  }

  function showPlacementPreview(me: number): void {
    scene.setPlacementPreview([
      ...st.changes.trees.filter((t) => t.owner === me).map((t) => ({ at: [t.tree.x, t.tree.y] as Vec2, r: t.tree.r, color: COLORS[me] })),
      ...st.changes.ponds.filter((q) => q.owner === me).map((q) => ({ at: q.c, r: q.r, color: '#4f8fcf' })),
    ]);
  }

  function placeAt(at: Vec2): void {
    const step = st.placing[0];
    if (st.stage !== 'placing' || !step || !mine(step.player)) return;
    const { player: me, kind } = step;
    const res = place(kind, at, { hole: hole(), blocked, trees: treesFor(trees, st.removed, st.changes, me), rng: Math.random });
    if (!res.ok) { chip(res.reason, 'hot'); return; }
    dispatch({
      t: 'place', player: me, kind,
      ...(res.kind === 'pond' ? { pond: res.pond } : res.kind === 'clear-cut' ? { target: st.refOf(res.target) } : { tree: res.tree }),
    });
  }

  $('place-skip').addEventListener('click', () => {
    const step = st.placing[0];
    if (st.stage !== 'placing' || !step || !mine(step.player)) return;
    dispatch({ t: 'place-skip', player: step.player });
  });

  /**
   * Default aim: from the fairway, the next bend of the hole line (else the basket). From the
   * woods, pitch back out: the point on the hole line ~25 m past the player's closest point.
   */
  function defaultTarget(from: Vec2): Vec2 {
    if (range) return R().baskets[0] ?? [0, 300 * FT];
    const h = hole();
    const pin = myPin();
    const dB = dist(from, pin);
    // OSM hole lines often trace the walking path; only real doglegs (> 8 m off straight) count.
    const bends = simplify(h.routing, 8, 2).slice(1, -1);
    if (dB > PUTT_RANGE && distToPolyline(from, h.routing) > 6) {
      const along = closestAlong(from, h.routing) + 25;
      const total = polylineLength(h.routing);
      return along >= total ? pin : pointAlong(h.routing, along);
    }
    for (const p of bends) if (dist(p, pin) < dB - 20 && dist(from, p) > 30) return p;
    return pin;
  }

  /** The current player's turn: aim and throw if they're ours, else watch for their throw. */
  function startTurn(): void {
    phase = mine(game().current) ? 'aim' : 'watching';
    liveAim = null;
    lastLive = '';
    hyzer = 0; // every throw starts flat and normal (forehand / backhand carries through the hole)
    shot = 'standard';
    $('hud').hidden = false;
    power = 0;
    fpOverride = null;
    perfectArmed = false;
    const p = player();
    // The range keeps the last throw's aim, disc and release, so the next one can change one thing.
    const k = range ? kept.get(game().current) : undefined;
    const again = !!k;
    if (k) ({ aimTarget, yaw, pitch, disc, hyzer, forehand, shot } = k);
    else {
      aimTarget = defaultTarget(p.ball);
      yaw = Math.atan2(aimTarget[1] - p.ball[1], aimTarget[0] - p.ball[0]);
      pitch = 0;
    }
    refreshViewer(game().current);
    const d = dist(p.ball, aimTarget);
    const bag = bagOf(game().current);
    if (!again) disc = toBasket() <= PUTT_RANGE && bag.includes(PUTTER_DISC) ? PUTTER_DISC : suggestDisc(d, ranges, bag);
    picker.setBag(st.bags[game().current]);
    gallery.clearLine(p.ball, myPin());
    // A new hole opens with its flyover (once); otherwise the camera glides to the new lie.
    const newHole = turnHole !== hole();
    turnHole = hole();
    if (newHole && !range && prefs().flyovers && introFor !== hole() && game().players.every((q) => q.strokes === 0)) startIntro();
    else applyCamera(!again, !newHole);
    if (phase === 'aim') recomputeTick();
    else showWait(`${p.name} is throwing…`);
    updateHud();
  }

  /** `glide`: ease from the current view instead of cutting (same view mode only). */
  function applyCamera(reframe: boolean, glide = false): void {
    const wasFP = scene.firstPerson;
    const fp = isFP();
    scene.setFirstPerson(fp);
    $('reticle').hidden = !fp;
    $('minimap').hidden = !fp;
    scene.setMinimapFrame([hole().tee, myPin(), ...hole().routing, ...game().players.filter((q) => !q.holed).map((q) => q.ball)]);
    const p = player();
    if (fp) scene.setEye(p.ball, yaw, pitch, glide && wasFP);
    else if (reframe) {
      const ahead = hole().routing.filter((r) => dist(r, myPin()) < toBasket() + 1);
      scene.frame([p.ball, myPin(), ...ahead], 90, toBasket() < 40 ? 20 : 12, glide && !wasFP);
    }
  }

  // ---------- hole intro: a flyover down the hole before its first throw ----------
  let intro: { t: number; dur: number; line: Vec2[]; len: number } | null = null;
  let introFor: unknown = null;
  let turnHole: unknown = null;

  function startIntro(): void {
    const h = hole();
    introFor = h;
    const line = h.routing.length > 1 ? h.routing : [h.tee, h.pin];
    const len = polylineLength(line);
    intro = { t: 0, dur: Math.min(7, Math.max(3.5, 2.5 + len / 45)), line, len };
    $('hud').hidden = true;
    $('minimap').hidden = true;
    $('reticle').hidden = true;
    scene.setFirstPerson(true);
    scene.minimapEnabled = false;
    const box = $('intro');
    box.querySelector('.num')!.innerHTML = `${esc(h.ref)}<small>HOLE</small>`;
    box.querySelector('.hname')!.textContent = h.name ?? course.name;
    box.querySelector('.hmeta')!.textContent = `Par ${h.par} · ${fmtLen(h.length_m)}`;
    const windText = `Wind ${fmtSpeed(Math.hypot(st.wind[0], st.wind[1]))}`;
    box.querySelector('.weather')!.textContent = roundWeather && prefs().weather && !space ? `${roundWeather.label} · ${windText}` : windText;
    // Restart the card's entrance animation.
    const card = box.querySelector<HTMLElement>('.intro-card')!;
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
    box.hidden = false;
    flyIntro(0);
  }

  /** From 25 m behind the tee, high, down the hole line to just short of the basket, looking ahead. */
  function flyIntro(dt: number): void {
    const it = intro!;
    it.t += dt;
    const k = Math.min(1, it.t / it.dur);
    const e = k * k * (3 - 2 * k);
    const s = -25 + (it.len - 18 + 25) * e;
    const [a, b] = [it.line[0], it.line[1]];
    const L0 = dist(a, b) || 1;
    const at: Vec2 = s < 0 ? [a[0] + ((a[0] - b[0]) / L0) * -s, a[1] + ((a[1] - b[1]) / L0) * -s] : pointAlong(it.line, s);
    const ahead = pointAlong(it.line, Math.min(it.len, Math.max(0, s) + 45));
    const pin = hole().pin;
    const m = Math.max(0, Math.min(1, (k - 0.55) / 0.45));
    const look: Vec3 = [ahead[0] + (pin[0] - ahead[0]) * m, ahead[1] + (pin[1] - ahead[1]) * m, 1.2 * m];
    scene.flyCam([at[0], at[1], 24 - 14 * e], look);
    if (k >= 1) endIntro();
  }

  function endIntro(): void {
    if (!intro) return;
    intro = null;
    $('intro').hidden = true;
    scene.minimapEnabled = true;
    if (phase !== 'aim' && phase !== 'charging' && phase !== 'watching') return;
    $('hud').hidden = false;
    applyCamera(true, true);
  }

  // ---------- fast-forward: hold Shift during a flight or replay ----------
  let ffHeld = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') ffHeld = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') ffHeld = false; });
  window.addEventListener('blur', () => { ffHeld = false; });

  // ---------- color commentary ----------
  let sayTimer = 0;
  function say(text: string): void {
    const el = $('commentary');
    clearTimeout(sayTimer);
    el.textContent = text;
    el.classList.remove('out');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    el.hidden = false;
    sayTimer = window.setTimeout(() => {
      el.classList.add('out');
      sayTimer = window.setTimeout(() => { el.hidden = true; }, 400);
    }, 3600);
  }

  function throwInput(pw: number): ThrowInput {
    const fp = isFP();
    return {
      start: player().ball, aim: yaw, power: pw, disc, hyzer, mirror: forehand, shot: puttStyle() ? 'standard' : shot,
      launch: fp ? pitch + launchOffset(disc, puttStyle(), shot) : undefined,
      style: puttStyle() ? 'putt' : 'drive',
      mods: modsFor(game().current),
      fromTee: player().strokes === 0,
    };
  }

  /** First-person look changed the launch angle: recompute the tick on the next frame. */
  let tickStale = false;
  const ghost = (pw: number) => simulateThrow(throwInput(pw), world(), () => 0.25, { ghost: true });

  /**
   * Meter tick. Throws: the power whose ghost flight comes to rest at the target. Putts: the power
   * whose ghost crosses the target distance at mid-chain height (more power → higher there).
   */
  function recomputeTick(): void {
    tickStale = false;
    const p = player();
    const d = dist(p.ball, aimTarget);
    const putting = puttStyle();
    const tooShort = (m: number) => {
      const g = ghost(m);
      if (!putting) return dist(p.ball, g.rest) < d;
      const at = g.samples.find((s) => Math.hypot(s[0] - p.ball[0], s[1] - p.ball[1]) >= d);
      return !at || at[2] < CHAIN_MID;
    };
    if (tooShort(1)) { tick = 1; return; }
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      if (tooShort(m)) lo = m; else hi = m;
    }
    tick = (lo + hi) / 2;
  }

  function startCharge(): void {
    if (phase !== 'aim') return;
    phase = 'charging';
    chargeStart = performance.now();
  }

  /** Lower is better: holed, then distance to the basket, with penalties counting heavily. */
  const outcomeScore = (r: ThrowResult) => (r.holed ? -1 : dist(r.rest, myPin()) + r.penalty * 30);

  /** Simulate the throw here, then show it; its event is applied (and sent) when it lands. */
  function release(): void {
    if (phase !== 'charging') return;
    kept.set(game().current, { aimTarget, yaw, pitch, disc, hyzer, forehand, shot });
    const me = game().current;
    const perfect = perfectArmed;
    perfectArmed = false;
    const input = { ...throwInput(Math.max(0.01, power)), perfect };
    let result = simulateThrow(input, world());
    let other: ThrowResult | null = null;
    if (modsFor(me).clone) {
      // Clone Disc: throw twice, keep the better one. Both fly; the other is shown faded.
      other = simulateThrow(input, world());
      if (outcomeScore(other) < outcomeScore(result)) [result, other] = [other, result];
    }
    const e: Extract<RoundEvent, { t: 'throw' }> = { t: 'throw', player: me, perfect, result: st.wire(result), clock: Math.round(gameClock * 1000) / 1000 }; // world() simulated at gameClock
    if (range) e.disc = disc.id;
    if (other) e.twin = st.wire(other).samples.filter((_, i) => i % 2 === 0);
    const early = sendNow(e);
    playThrow(e, puttStyle() ? 1 : prefs().playback, false);
    if (flight) flight.sentEarly = early;
  }

  const cuesFor = (e: Extract<RoundEvent, { t: 'throw' }>) => throwCues(e.result, range ? nearestBasket(e.result.rest) : pinOf(e.player), (x, y) => grid.classAt(x, y));
  const nearestBasket = (p: Vec2): Vec2 => R().baskets.reduce<Vec2>((a, b) => (dist(b, p) < dist(a, p) ? b : a), NO_BASKET);
  /**
   * Play the flight's sounds up to sample t. Watched from the tee they fade with distance; from the
   * chase camera (replay, following a friend) they're right there.
   */
  function soundUpTo(t: number, chase: boolean): void {
    const f = flight!;
    const s0 = f.result.samples[0];
    while (f.cue < f.cues.length && f.cues[f.cue].k <= t) {
      const c = f.cues[f.cue++];
      const d = Math.hypot(c.at[0] - s0[0], c.at[1] - s0[1]);
      playCue(c, chase ? 0.9 : Math.max(0.25, Math.min(1, 25 / Math.max(1, d))));
      cueFx(c);
    }
  }

  /** What a cue looks like: leaves, a puff of the ground, a splash, sparks, chains swinging. */
  function cueFx(c: Cue): void {
    switch (c.sound) {
      case 'tree': effects.leaves(c.at); break;
      case 'branch': effects.leaves(c.at, 7); break;
      case 'bonk': effects.sparks(c.at); break;
      case 'chains': case 'clank': scene.shakeChains(range ? nearestBasket([c.at[0], c.at[1]]) : undefined); break;
      case 'land': effects.puff(c.at, opts.course === 'rainbow' ? PUFF.rainbow : PUFF[c.surface ?? 'fairway'] ?? PUFF.fairway); break;
      case 'splash': effects.splash(c.at); break;
    }
  }

  /** Fly a throw event's disc (then replay it, then apply it). `remote`: another player's throw. */
  function playThrow(e: Extract<RoundEvent, { t: 'throw' }>, speed: number, remote: boolean): void {
    hideWait();
    // Someone else's throw: their clock is the one the moving props were simulated at, so take it.
    if (remote && e.clock !== undefined) gameClock = e.clock;
    flight = { e, result: e.result, t: 0, speed, clock0: gameClock, remote, sentEarly: false, cues: cuesFor(e), cue: 0 };
    endIntro();
    gallery.onThrow(e.result.samples);
    sfx('swish', { gain: remote ? 0.5 : 0.8 });
    if (following(flight)) flight.speed = REPLAY_SPEED; // ridden along at replay pace
    const s = e.result.samples, h0 = Math.atan2(s[Math.min(8, s.length - 1)][1] - s[0][1], s[Math.min(8, s.length - 1)][0] - s[0][0]);
    Object.assign(follow, { heading: h0, smooth: h0, started: false, last: performance.now() });
    scene.lockTrees(e.result.samples.map((q): Vec2 => [q[0], q[1]])); // no tree LOD changes while following it
    liveAim = null;
    phase = 'flying';
    scene.setPreview(null, '#fff');
    updateHud();
  }

  /** Live chase camera for a friend's throw (online, Settings → Follow friends' throws). */
  const follow = { heading: 0, smooth: 0, started: false, last: 0 };
  const following = (f: NonNullable<typeof flight>) => f.remote && !f.show && !!net && prefs().follow;
  function endFollow(): void {
    scene.endChase();
    scene.minimapEnabled = true;
    finishThrow();
  }

  let pendingTimer = 0;
  /** Crazy mode: the few seconds after a throw when M takes it back. */
  let mulliganOpen = false;

  function startReplay(): void {
    const s = flight!.result.samples;
    if (!flight!.show && (!replaysOn() || s.length < REPLAY_MIN_SAMPLES)) return finishThrow();
    phase = 'replay';
    // Start behind the disc, looking along its first few meters (the thrower's aim).
    const h0 = Math.atan2(s[Math.min(8, s.length - 1)][1] - s[0][1], s[Math.min(8, s.length - 1)][0] - s[0][0]);
    replay = { t: 0, heading: h0, smoothHeading: h0, started: false, last: performance.now() };
    flight!.cue = 0;
    scene.setFirstPerson(true);
    scene.minimapEnabled = false;
    $('minimap').hidden = true;
    $('reticle').hidden = true;
    $('replay-bar').hidden = false;
    $('hud').hidden = true;
  }

  function endReplay(): void {
    if (!replay) return;
    replay = null;
    scene.endChase();
    scene.minimapEnabled = true;
    $('replay-bar').hidden = true;
    $('hud').hidden = false;
    if (flight?.show) return endHighlight();
    finishThrow();
  }

  function finishThrow(): void {
    if (range) return finishPractice();
    const { e, remote, sentEarly } = flight!;
    scene.lockTrees(null);
    const r = e.result;
    const idx = e.player;
    if (e.twin) scene.addTrail(e.twin, game().players[idx].color, 0.25);
    scene.addTrail(r.samples, game().players[idx].color);
    flight = null;
    // The throw lands: strokes, lie, Lumberjack, the hole's score if it's over. Ours is sent now.
    if (remote) st.apply(e);
    else if (sentEarly) st.apply(JSON.parse(JSON.stringify(e)) as RoundEvent); // sent at release
    else dispatch(e);
    const done = game().players[idx];
    // Broadcast graphics: a chip per distinct event, a result banner when someone holes out.
    const msgs = [...(r.propHits ?? []).map((t) => propToasts.get(t) ?? 'Bonk!'), ...r.events.map((e) => course.toasts?.[e] ?? EVENT_TOASTS[e])]
      .filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
    const eventTone = (m: string): Tone => (/OB|Splash|\+1/.test(m) ? 'bogey' : /Saved|Magnet|Phased/.test(m) ? 'info' : 'hot');
    if (!done.holed) for (const m of msgs) chip(m, eventTone(m));
    let shown = msgs.length > 0;
    if (done.holed) {
      const par = hole().par;
      banner({
        word: scoreWord(done.strokes, par).toUpperCase(), tone: scoreTone(done.strokes, par), who: done.name, color: done.color,
        what: `Hole ${hole().ref} · ${done.strokes} ${done.strokes === 1 ? 'throw' : 'throws'}`, score: fmtPar(liveToPar(idx)),
      });
      if (r.events.includes('chains')) chip('Chains', 'birdie');
      const tone = scoreTone(done.strokes, par);
      sfx(JINGLES[tone], { delay: 0.15 });
      if (tone === 'ace' || tone === 'eagle') sfx('applause', { gain: 0.7, fadeAfter: 3 });
      else if (tone === 'birdie') sfx('applause', { gain: 0.35, fadeAfter: 1.2 });
      shown = true;
    } else if (done.pickedUp) {
      sfx('jingle-bogey');
      banner({ word: 'PICKED UP', tone: 'double', who: done.name, color: done.color, what: `Hole ${hole().ref} · max ${done.strokes}`, score: fmtPar(liveToPar(idx)) });
      shown = true;
    }
    // Color commentary, and the gallery's reaction.
    const s0: Vec2 = [r.samples[0][0], r.samples[0][1]];
    const before = dist(s0, pinOf(idx));
    const line = commentary({
      carried: dist(s0, r.rest), before, after: done.holed ? 0 : dist(r.rest, pinOf(idx)), holed: done.holed, strokes: done.strokes,
      par: hole().par, events: r.events, props: r.propHits?.length ?? 0, putt: before <= PUTT_RANGE,
    });
    if (line) say(line);
    if (done.holed) gallery.react(['ace', 'eagle', 'birdie'].includes(scoreTone(done.strokes, hole().par)) ? 'cheer' : 'yes', pinOf(idx));
    else if (r.events.some((x) => x === 'spit' || x === 'cut' || x === 'band' || x === 'tray' || x === 'pole')) gallery.react('no', pinOf(idx));
    // Mulligan window: a few seconds to take the throw back (not after holing out). Everyone
    // waits the same time, so nobody moves on while the thrower can still take it back.
    const canMull = rogue && !done.holed && mulligansLeft[idx] > 0;
    if (canMull && mine(idx)) chip('Press M for a mulligan', 'info', `${mulligansLeft[idx]} left`, 2600);
    mulliganOpen = canMull && mine(idx);
    phase = 'between';
    updateHud();
    const wait = canMull ? 2600 : done.holed ? 2200 : shown ? 1300 : 600;
    pendingTimer = window.setTimeout(() => { mulliganOpen = false; phase = 'idle'; advance(); }, game().finished ? Math.max(1500, wait) : wait);
  }

  /**
   * A range throw has landed: show how far it went and how far off line. Applying it just passes the
   * turn on; everyone throws from the tee.
   */
  function finishPractice(): void {
    const { e, remote, sentEarly } = flight!;
    scene.lockTrees(null);
    const r = e.result;
    const who = game().players[e.player];
    scene.addTrail(r.samples, who.color);
    flight = null;
    if (remote) st.apply(e);
    else if (sentEarly) st.apply(JSON.parse(JSON.stringify(e)) as RoundEvent);
    else dispatch(e);
    const tee = hole().tee;
    const carried = dist(tee, r.rest);
    const side = r.rest[0] - tee[0];
    const msgs = [...(r.propHits ?? []).map(() => 'Bonk!'), ...r.events.map((x) => EVENT_TOASTS[x])]
      .filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !/\+1/.test(m));
    const name = opts.names.length > 1 ? `${who.name}: ` : '';
    if (r.holed) {
      chip(`${name}Chains!`, 'birdie', fmtLen(carried));
      sfx('jingle-birdie', { delay: 0.15 });
    } else {
      chip(`${name}${fmtLen(carried)}`, 'info', Math.abs(side) < 1 ? 'on line' : `${fmtLen(Math.abs(side))} ${side < 0 ? 'left' : 'right'}`, 2600);
      for (const m of msgs) chip(m, 'hot');
    }
    panel?.addShot({ who: who.name, color: who.color, disc: DISCS.find((d) => d.id === e.disc)?.name ?? '', dist: carried, side, holed: r.holed });
    phase = 'between';
    updateHud();
    pendingTimer = window.setTimeout(() => { phase = 'idle'; advance(); }, r.holed ? 1400 : 900);
  }

  function takeMulligan(): void {
    if (!mulliganOpen || !st.undo || phase !== 'between') return;
    dispatch({ t: 'mulligan', player: st.undo.idx });
  }

  /** A mulligan landed (ours or theirs): take the trail back and replay the turn. */
  function presentMulligan(): void {
    clearTimeout(pendingTimer);
    mulliganOpen = false;
    scene.popTrail();
    chip('Mulligan', 'info');
    phase = 'idle';
  }

  /** To par over completed holes plus the current hole if this player has finished it. */
  function liveToPar(i: number): number {
    const q = game().players[i];
    const recorded = round.scores[i][round.index] !== undefined;
    return round.toPar(i) + (!recorded && (q.holed || q.pickedUp) ? q.strokes - hole().par : 0);
  }

  function scoreWord(strokes: number, par: number): string {
    if (strokes === 1) return 'ACE!';
    const n: Record<number, string> = { [-3]: 'Albatross', [-2]: 'Eagle', [-1]: 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
    return n[strokes - par] ?? `+${strokes - par}`;
  }

  // ---------- scorecard ----------
  /** Hole card, or (readOnly, from the pause menu) a mid-round look with just a Close button. */
  function showCard(readOnly = false): void {
    const last = round.isLastHole;
    const idx = [...Array(round.count).keys()].map((k) => round.first + k);
    const head = `<thead><tr><th></th>${idx.map((i) => `<th>${course.holes[i].ref}</th>`).join('')}<th>TOT</th><th>±</th></tr></thead>`;
    const par = `<tr class="par"><td class="player">Par</td>${idx.map((i) => `<td>${course.holes[i].par}</td>`).join('')}<td class="tot">${idx.reduce((s, i) => s + course.holes[i].par, 0)}</td><td></td></tr>`;
    const mark = (v: number, p: number) => {
      const d = v - p;
      const cls = v === 1 || d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
      return `<span class="mk ${cls}">${v}</span>`;
    };
    const order = opts.names.map((_, p) => p).sort((a, b) => liveToPar(a) - liveToPar(b));
    const rows = order.map((p) => {
      const tp = liveToPar(p);
      return `<tr><td class="player"><i style="background:${COLORS[p]}"></i>${esc(opts.names[p])}</td>${idx.map((i) => {
        const v = round.scores[p][i];
        return `<td>${v === undefined ? '' : mark(v, course.holes[i].par)}</td>`;
      }).join('')}<td class="tot">${round.total(p) || ''}</td><td class="pm topar ${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${fmtPar(tp)}</td></tr>`;
    });
    // Crazy mode: everyone's augments under the card (hover a chip for what it does).
    $('results-augs').hidden = !rogue;
    if (rogue) {
      $('results-augs').innerHTML = order.map((p) => `<div class="who"><b><i style="background:${COLORS[p]}"></i>${esc(opts.names[p])}</b>${
        owned[p].length ? stacked(owned[p]).map(([q, n]) => chipFor(q, n)).join('') : '<span class="none">no augments yet</span>'}</div>`).join('');
    }
    renderSummary(last && game().finished);
    $('results-title').textContent = readOnly ? 'Scorecard' : last ? 'Final card' : `Hole ${hole().ref} complete`;
    $('results-table').innerHTML = head + '<tbody>' + par + rows.join('') + '</tbody>';
    // Online, only the host moves everyone on to the next hole.
    // Online, the final card's way on is the host's: everyone back to the room's lobby together.
    $('next').hidden = readOnly || last || !isHost;
    $('card-wait').hidden = readOnly || isHost;
    $('card-wait').textContent = last ? 'Waiting for the host to go back to the lobby…' : 'Waiting for the host to continue…';
    $('again').hidden = readOnly || !last || !isHost;
    $('again').textContent = net ? 'Back to lobby' : 'Play again';
    $('leave').hidden = readOnly || !last || !net;
    $('card-close').hidden = !readOnly;
    $('results').hidden = false;
    if (!readOnly) { $('hud').hidden = true; clearBroadcast(); }
  }
  $('card-close').addEventListener('click', () => { $('results').hidden = true; });

  // ---------- round summary (final card) ----------
  /** Highlights over the whole round, each big shot with a Watch button that replays it. */
  function renderSummary(show: boolean): void {
    const box = $('results-summary');
    box.hidden = !show;
    if (!show) return;
    const r = roundStats(st.log, opts.names.length, round.first);
    const who = (p: number) => `<i style="background:${COLORS[p]}"></i>${esc(opts.names[p])}`;
    const watch = (k: ShotRef) => `<button data-at="${k.at}">▶ Watch</button>`;
    const tiles: string[] = [];
    const tile = (label: string, big: string, line: string, extra = '') => tiles.push(`<div class="hl"><small>${label}</small><b>${big}</b><span>${line}</span>${extra}</div>`);
    if (r.longest) tile('Longest throw', fmtLen(r.longest.dist), `${who(r.longest.player)} · hole ${course.holes[r.longest.hole].ref}`, watch(r.longest));
    if (r.bestMake) tile('Longest make', fmtLen(r.bestMake.dist), `${who(r.bestMake.player)} · hole ${course.holes[r.bestMake.hole].ref}`, watch(r.bestMake));
    const trees = r.players.map((q, p) => ({ p, n: q.trees })).sort((a, b) => b.n - a.n)[0];
    if (trees && trees.n > 0) tile('Tree magnet', `${trees.n} ${trees.n === 1 ? 'tree' : 'trees'}`, who(trees.p));
    else tile('Tree magnet', 'Nobody', 'not one tree hit all round');
    const aces = r.players.map((q, p) => ({ p, n: q.aces })).filter((a) => a.n > 0);
    if (aces.length) tile(aces.reduce((a, b) => a + b.n, 0) === 1 ? 'Ace' : 'Aces', aces.map((a) => (a.n > 1 ? `${a.n}×` : '★')).join(' '), aces.map((a) => who(a.p)).join(' '));
    const clean = r.players.map((q, p) => ({ p, n: q.penalties })).sort((a, b) => a.n - b.n);
    if (opts.names.length > 1 && clean.length && clean[0].n === 0) tile('Clean card', 'No penalties', clean.filter((c) => c.n === 0).map((c) => who(c.p)).join(' '));
    box.innerHTML = tiles.join('');
    box.querySelectorAll<HTMLButtonElement>('button[data-at]').forEach((b) => b.addEventListener('click', () => watchShot(parseInt(b.dataset.at!, 10))));
  }

  let beforeHighlight: Phase | null = null;
  /** Replay a throw from the log with the chase camera, then come back to the card. */
  function watchShot(at: number): void {
    const e = st.log[at];
    if (!e || e.t !== 'throw' || flight) return;
    $('results').hidden = true;
    beforeHighlight = phase;
    flight = { e, result: e.result, t: 0, speed: 1, clock0: e.clock ?? gameClock, remote: true, sentEarly: false, show: true, cues: cuesFor(e), cue: 0 };
    scene.lockTrees(e.result.samples.map((q): Vec2 => [q[0], q[1]]));
    startReplay();
  }

  function endHighlight(): void {
    scene.lockTrees(null);
    flight = null;
    phase = beforeHighlight ?? 'idle';
    beforeHighlight = null;
    applyCamera(true);
    $('hud').hidden = true;
    $('results').hidden = false;
  }
  window.addEventListener('show-scorecard', () => showCard(true));

  $('next').addEventListener('click', () => {
    if (st.stage !== 'card' || !isHost) return;
    dispatch({ t: 'next' });
  });

  // ---------- bag building ----------
  /** The discs player p carries (all of them without bag building). */
  const bagOf = (p: number): Disc[] => { const b = st.bags[p]; return b ? DISCS.filter((d) => b.includes(d.id)) : DISCS; };
  /** Picks in progress, per player (kept while other players' bags arrive). */
  const bagDraft = new Map<number, string[]>();
  /** Everyone picks their bag (online, all at once): ours here, the others' arrive as events. */
  function bagStep(): void {
    $('hud').hidden = true;
    $('results').hidden = true;
    const need = st.needBag;
    const pi = need.find((p) => mine(p));
    if (pi === undefined) {
      $('bag').hidden = true;
      showWait(`Waiting for ${need.map((p) => opts.names[p]).join(', ')} to pick ${need.length === 1 ? 'a bag' : 'their bags'}`);
      return;
    }
    hideWait();
    const size = st.bagSize(pi);
    // Start from what they carried (adding a pocket), else the four everyday discs.
    if (!bagDraft.has(pi)) bagDraft.set(pi, st.bags[pi] ? [...st.bags[pi]!] : DISCS.filter((d) => d.suggest).map((d) => d.id).slice(0, size));
    const pick = bagDraft.get(pi)!;
    const render = () => {
      $('bag-title').innerHTML = `<span style="color:${COLORS[pi]}">●</span> ${esc(opts.names[pi])}: pick your bag`;
      $('bag-count').textContent = `${pick.length} / ${size}`;
      $('bag-sub').textContent = st.bags[pi]
        ? `Bag Pocket: room for ${size} discs now. Add one.`
        : `Carry ${size} of the ${DISCS.length} discs for the whole round. Inside putting range you putt with the putter, if you carry one.`;
      $('bag-cards').innerHTML = DISCS.map(discCard).join('');
      $('bag-cards').querySelectorAll<HTMLButtonElement>('.disc-card').forEach((b) => {
        const id = b.dataset.id!;
        b.classList.toggle('on', pick.includes(id));
        b.addEventListener('click', () => {
          const i = pick.indexOf(id);
          if (i >= 0) pick.splice(i, 1);
          else if (pick.length < size) pick.push(id);
          render();
        });
      });
      $<HTMLButtonElement>('bag-ok').disabled = pick.length !== size;
    };
    $('bag-ok').onclick = () => {
      if (pick.length !== size || !st.needBag.includes(pi)) return;
      bagDraft.delete(pi);
      $('bag').hidden = true;
      dispatch({ t: 'bag', player: pi, discs: [...pick] });
    };
    render();
    $('bag').hidden = false;
  }

  // ---------- Crazy mode drafts ----------
  /** The drafter's turn: deal them cards (as an event) and let them pick, or wait for them. */
  function draftStep(): void {
    const pi = st.drafting[0];
    $('hud').hidden = true;
    $('results').hidden = true;
    if (!mine(pi)) {
      $('draft').hidden = true;
      showWait(`${opts.names[pi]} is picking ${st.starter ? 'a starter augment' : 'an augment'}`);
      return;
    }
    if (!st.offer || st.offer.player !== pi) deal(pi);
    renderDraft(pi);
  }

  /**
   * The cards are drawn here and travel in the 'offer' event. The tier is the group's: the first
   * offer of a draft rolls it (from the rules' odds), everyone after gets the same.
   */
  function deal(pi: number, tier?: Tier): void {
    const t = tier ?? st.draftTier ?? rollTier(Math.random, tierWeights(st.rules, st.starter));
    const o = drawOffer(Math.random, owned[pi], st.rules.cards + mods[pi].extraCard, t, opts.names.length, !!opts.bag);
    dispatchQuiet({ t: 'offer', player: pi, tier: o.tier, cards: o.cards.map((c) => c.id), bumped: o.bumped, starter: st.starter });
  }

  function renderDraft(pi: number): void {
    const offer = { ...st.offer!, cards: st.offer!.cards.map(byId) };
    sfx('deal');
    $('draft-title').innerHTML = `<span style="color:${COLORS[pi]}">●</span> ${esc(opts.names[pi])}: ${st.starter ? 'pick your starter augment' : 'pick an augment'}`;
    $('draft-tier').textContent = `${offer.tier[0].toUpperCase()}${offer.tier.slice(1)} draft`;
    $('draft-tier').className = `tier ${offer.tier}`;
    $('draft-cards').innerHTML = offer.cards.map((c, i) => `<button class="pcard ${c.tier}" data-i="${i}">
        <span class="ptier">${c.tier}${offer.bumped === i ? ' ★ bumped' : ''}</span>
        <span class="pcat">${esc(CATEGORIES.find((k) => k.id === c.category)?.label ?? '')}</span>
        <b>${esc(c.name)}</b><span>${esc(convertText(c.text))}</span></button>`).join('');
    $('draft-reroll').hidden = mods[pi].rerolls <= 0;
    $('draft-reroll').textContent = `Reroll (${mods[pi].rerolls})`;
    $('draft-owned').textContent = owned[pi].length ? `Have: ${owned[pi].map((id) => byId(id).name).join(', ')}` : '';
    $('draft-cards').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      if (st.drafting[0] !== pi) return;
      dispatch({ t: 'pick', player: pi, id: st.offer!.cards[parseInt(b.dataset.i!, 10)] });
    }));
    $('draft-reroll').onclick = () => {
      if (st.drafting[0] !== pi || mods[pi].rerolls <= 0) return;
      const tier = st.offer!.tier;
      dispatchQuiet({ t: 'reroll', player: pi });
      deal(pi, tier);
      renderDraft(pi);
    };
    $('draft-skip').onclick = () => { if (st.drafting[0] === pi) dispatch({ t: 'pick', player: pi, id: null }); };
    $('draft').hidden = false;
  }
  $('again').addEventListener('click', () => {
    if (net) { if (isHost) net.room.end(); return; } // the room's 'ended' brings everyone back, us too
    location.reload();
  });
  $('leave').addEventListener('click', () => {
    net?.room.close();
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  });
  // Online host: end the game early (the range never ends on its own).
  $('pause-lobby').hidden = !net || !isHost;
  $('pause-lobby').addEventListener('click', () => {
    if (net && isHost && confirm('End this game and take everyone back to the lobby?')) net.room.end();
  });
  /** The room is back in its lobby: reload into it (the menu rejoins the room without asking names). */
  function backToLobby(): void {
    if (!net) return;
    try { sessionStorage.setItem('sat-golf:rejoin', net.room.code); } catch { /* storage unavailable: the name prompt shows */ }
    net.room.close();
    location.reload(); // the address still has #room=CODE
  }

  // ---------- HUD ----------


  /** The release chip: angle and hand; overhand shots have neither (they're thrown on edge). */
  function releaseText(h: number, fh: boolean, sh: Shot): string {
    if (sh === 'tomahawk' || sh === 'thumber') return 'Overhand';
    return sh === 'roller' ? (fh ? 'Forehand' : 'Backhand') : `${releaseLabel(h)} · ${fh ? 'Forehand' : 'Backhand'}`;
  }

  function releaseLabel(h = hyzer): string {
    if (h === 0) return 'Flat';
    const deg = Math.round(Math.abs(h) * 20);
    return `${h > 0 ? 'Hyzer' : 'Anhyzer'} ${deg}°`;
  }

  function updateHud(): void {
    const p = player();
    $('turn').innerHTML = `<span style="color:${p.color}">●</span> ${esc(p.name)}`;
    picker.update(disc, forehand);
    $('release').textContent = releaseText(hyzer, forehand, puttStyle() ? 'standard' : shot);
    $('shot').textContent = SHOT_LABELS[puttStyle() ? 'standard' : shot];
    $('shot').hidden = puttStyle();
    const me = game().current;
    $('rogue-bar').hidden = !rogue;
    if (rogue) {
      const bits = [`⚡ ${owned[me].length} augment${owned[me].length === 1 ? '' : 's'}`];
      if (mods[me].mulligans) bits.push(`Mulligans ${mulligansLeft[me]} (M)`);
      if (mods[me].perfectForm) bits.push(perfectArmed ? '<b>Perfect Form ARMED</b>' : `Perfect Form ${perfectLeft[me]} (P)`);
      $('rogue-bar').innerHTML = bits.join(' · ');
      $('rogue-bar').title = owned[me].map((id) => `${byId(id).name}: ${convertText(byId(id).text)}`).join('\n');
    }
    if (range) {
      const pin = rangePin();
      $('stats').innerHTML = `${pin ? `Basket <b>${fmtLen(dist(p.ball, pin))}</b> · ` : ''}Target <b>${fmtLen(dist(p.ball, aimTarget))}</b> · Throws <b>${st.rangeThrows}</b>`;
      panel?.lock(mine(game().current) ? null : { name: p.name, color: p.color });
    } else $('stats').innerHTML = `Basket <b>${fmtLen(toBasket())}</b> · Target <b>${fmtLen(dist(p.ball, aimTarget))}</b> · Lie <b>${LIE_LABELS[p.lie] ?? p.lie}</b> · Throw <b>${p.strokes + 1}</b>`;
    $('meter-fill').style.width = `${power * 100}%`;
    $('meter-target').style.left = `${tick * 100}%`;
    $('view-toggle').textContent = VIEW_LABELS[scene.viewMode];
    $('fp-toggle').textContent = isFP() ? '1st person' : 'Top-down';
    $('swing').toggleAttribute('disabled', phase !== 'aim' && phase !== 'charging');
    $('swing').innerHTML = `Hold to ${puttStyle() ? 'putt' : 'throw'} <kbd>Space</kbd>`;
    $('help').textContent = (isFP()
      ? 'Drag or arrows to aim (up/down = launch) · W/S target distance · scroll zoom · click minimap to aim · Q/E release angle · [ / ] disc · T forehand · G shot · C top-down · V view'
      : 'Click to aim · ←/→ fine aim · W/S target distance · Q/E release angle · [ / ] disc · T forehand · G shot · C 1st person · right-drag pan · scroll zoom · V view · F re-frame')
      .replace(vector ? ' · V view' : '\u0000', '');
    if (range) { rangeBoard(); return; }
    const lbOrder = game().players.map((_, i) => i).sort((a, b) => liveToPar(a) - liveToPar(b));
    $('scoreboard').innerHTML = `<div class="lb-head"><span>LEADERBOARD</span><span>HOLE ${esc(hole().ref)}</span></div>` + lbOrder.map((i) => {
      const q = game().players[i];
      const tp = liveToPar(i);
      const state = q.holed ? `${scoreWord(q.strokes, hole().par)}` : q.pickedUp ? 'picked up' : `${fmtLen(dist(q.ball, pinOf(i)))} · ${LIE_LABELS[q.lie] ?? q.lie}`;
      return `<div class="row ${i === game().current && !game().finished ? 'active' : ''}"><span class="bar" style="background:${q.color}"></span><span><div class="name">${esc(q.name)}</div><div class="state">${state}</div></span><span class="strokes">${q.strokes}</span><span class="topar ${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${fmtPar(tp)}</span></div>`;
    }).join('') + upNext();
  }

  /** Range with friends: everyone's throws and longest, and who's up (in the range panel). */
  function rangeBoard(): void {
    $('scoreboard').innerHTML = '';
    const tee = hole().tee;
    const best = opts.names.map(() => ({ throws: 0, longest: 0 }));
    for (const e of st.log) if (e.t === 'throw') { best[e.player].throws++; best[e.player].longest = Math.max(best[e.player].longest, Math.round(dist(tee, e.result.rest) * 10) / 10); }
    panel?.setPlayers(game().players.map((q, i) => ({ name: q.name, color: q.color, ...best[i], up: i === game().current })));
  }

  /** Who throws after the current player, by the away rule as things stand (it can change). */
  function upNext(): string {
    if (game().finished || st.stage !== 'playing') return '';
    const next = game().order().filter((i) => i !== game().current).slice(0, 3);
    if (!next.length) return '';
    return `<div class="lb-next"><small>UP NEXT</small>${next.map((i) => `<span><i style="background:${COLORS[i]}"></i>${esc(opts.names[i])}</span>`).join('›')}</div>`;
  }

  // ---------- input ----------
  const canvas = scene.renderer.domElement;
  let drag: { x: number; y: number; mode: 'aim' | 'pan' | 'look' | 'orbit' } | null = null;

  function setAimTarget(t: Vec2): void {
    aimTarget = t;
    const b = player().ball;
    yaw = Math.atan2(t[1] - b[1], t[0] - b[0]);
    recomputeTick();
    updateHud();
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (intro) { endIntro(); return; }
    // Replay: drag orbits the camera around the disc (clicking doesn't skip; Space does).
    if (phase === 'replay') { drag = { x: e.clientX, y: e.clientY, mode: 'orbit' }; return; }
    if (phase === 'placing') {
      if (e.button === 0 && mine(st.placing[0]?.player ?? -1)) placeAt(scene.screenToWorld(e.clientX, e.clientY));
      else drag = { x: e.clientX, y: e.clientY, mode: 'pan' };
      return;
    }
    if (isFP()) drag = { x: e.clientX, y: e.clientY, mode: 'look' };
    else if (e.button === 0 && phase === 'aim' && panel?.tool) rangeEdit(panel.tool, scene.screenToWorld(e.clientX, e.clientY));
    else if (e.button === 0 && phase === 'aim') { drag = { x: e.clientX, y: e.clientY, mode: 'aim' }; setAimTarget(scene.screenToWorld(e.clientX, e.clientY)); }
    else drag = { x: e.clientX, y: e.clientY, mode: 'pan' };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'aim' && phase === 'aim') setAimTarget(scene.screenToWorld(e.clientX, e.clientY));
    else if (drag.mode === 'pan') scene.panPixels(e.clientX - drag.x, e.clientY - drag.y);
    else if (drag.mode === 'orbit') {
      const o = scene.orbit;
      o.yaw -= (e.clientX - drag.x) * 0.006;
      o.elev = Math.min(1.45, Math.max(-0.1, o.elev + (e.clientY - drag.y) * 0.005));
    }
    else if (drag.mode === 'look' && (phase === 'aim' || phase === 'charging')) {
      look((-(e.clientX - drag.x) * 0.0025), (-(e.clientY - drag.y) * 0.0025));
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    if (phase === 'replay') {
      // Replay: scroll moves the camera closer to / farther from the disc.
      scene.orbit.dist = Math.min(60, Math.max(1.2, scene.orbit.dist / f));
      return;
    }
    if (isFP()) scene.zoomFov(1 / f);
    else scene.zoomAt(e.clientX, e.clientY, f);
  }, { passive: false });

  /** First-person look: yaw/pitch deltas in radians. Keeps the aim target at the same distance. */
  function look(dYaw: number, dPitch: number): void {
    yaw += dYaw;
    pitch = Math.min(0.6, Math.max(-0.35, pitch + dPitch));
    const b = player().ball;
    const d = dist(b, aimTarget) || toBasket();
    aimTarget = [b[0] + Math.cos(yaw) * d, b[1] + Math.sin(yaw) * d];
    scene.setEye(b, yaw, pitch);
    if (phase === 'aim') tickStale = true; // recomputed once per frame, not per pointer event
    updateHud();
  }

  function rotateAim(deg: number): void {
    if (phase !== 'aim') return;
    if (isFP()) return look((deg * Math.PI) / 180, 0);
    const b = player().ball;
    const a = yaw + (deg * Math.PI) / 180;
    const d = dist(b, aimTarget);
    setAimTarget([b[0] + Math.cos(a) * d, b[1] + Math.sin(a) * d]);
  }

  /** Move the target along the aim line (W/S), keeping direction. */
  function nudgeTargetDistance(dm: number): void {
    if (phase !== 'aim') return;
    const b = player().ball;
    const d = Math.max(1, dist(b, aimTarget) + dm);
    aimTarget = [b[0] + Math.cos(yaw) * d, b[1] + Math.sin(yaw) * d];
    recomputeTick();
    updateHud();
  }

  // Minimap click: aim at that point (direction and distance).
  $('minimap').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (phase !== 'aim') return;
    const w = scene.minimapToWorld(e.clientX, e.clientY);
    if (!w) return;
    setAimTarget(w);
    scene.setEye(player().ball, yaw, pitch);
  });

  const picker = mountDiscPicker($('disc-picker'), (d) => {
    if (phase !== 'aim' || !bagOf(game().current).includes(d)) return;
    disc = d;
    recomputeTick();
    updateHud();
  });

  // ---------- quick chat ----------
  /** Who this browser speaks as: online, our seat; hot seat, whoever is up. */
  const chatter = () => (net ? opts.names.findIndex((_, p) => net.mine(p)) : game().current);
  mountQuickChat((line) => {
    const p = chatter();
    showChat(opts.names[p], COLORS[p], line);
    net?.room.sendLive({ chat: line, player: p });
  }, () => chatter() >= 0 && $('setup').hidden === true);

  // ---------- driving range panel: wind, weather, baskets and trees ----------
  /** Only whoever's turn it is sets the range, while lining up their throw. */
  const canSetRange = () => range && phase === 'aim' && mine(game().current);
  const panel = range ? mountRangePanel($('range-panel'), rs, {
    change: (what) => {
      if (what === 'ghost') return; // our own view only
      sendRange();
    },
    tool: (t) => {
      canvas.style.cursor = t ? 'crosshair' : '';
      if (!t || !isFP()) return;
      // Placing happens on the map.
      preferFP = false;
      fpOverride = null;
      scene.setFirstPerson(false);
      $('reticle').hidden = true;
      $('minimap').hidden = true;
      scene.frame([hole().tee, [0, 400 * FT], ...R().baskets, ...R().trees.map((q): Vec2 => [q.x, q.y])], 60, 12, true);
      updateHud();
    },
    clearLines: () => scene.clearTrails(),
    reset: () => {
      rs.baskets = freshRange().baskets;
      rs.trees = [];
      sendRange();
    },
  }) : null;
  $('range-panel').hidden = !range;
  $('pause-card').hidden = range;

  /**
   * The panel changed our copy of the range: if it's ours to set, save it and send it to everyone
   * (it applies here too); if not, put the round's back.
   */
  function sendRange(): void {
    if (!canSetRange()) { presentRange(); return; }
    saveRange(rs);
    dispatchQuiet({ t: 'range', setup: rangeConditions(rs) });
    presentRange();
  }

  /** The round's range changed (ours or someone else's): rebuild what the disc can hit, redraw. */
  function presentRange(): void {
    const r = st.range;
    if (!r) return;
    Object.assign(rs, rangeConditions(r));
    panel?.refresh();
    rangeTrees = new TreeIndex(r.trees);
    scene.setBaskets(r.baskets);
    wind(Math.hypot(st.wind[0], st.wind[1]));
    setTreeWind(st.wind);
    applyWeather();
    refreshViewer(game().current);
    if (phase === 'aim') recomputeTick();
    updateHud();
  }

  function rangeEdit(tool: RangeTool, at: Vec2): void {
    if (!canSetRange()) return;
    const tee = hole().tee;
    if (tool === 'remove') {
      const b = rs.baskets.find((q) => dist(q, at) < 2.5);
      const t = rs.trees.reduce<Tree | null>((a, q) => (Math.hypot(q.x - at[0], q.y - at[1]) < Math.max(2, q.r) && (!a || Math.hypot(q.x - at[0], q.y - at[1]) < Math.hypot(a.x - at[0], a.y - at[1])) ? q : a), null);
      if (b && (!t || dist(b, at) <= Math.hypot(t.x - at[0], t.y - at[1]))) rs.baskets = rs.baskets.filter((q) => q !== b);
      else if (t) rs.trees = rs.trees.filter((q) => q !== t);
      else { chip('Nothing there to remove', 'hot'); return; }
      sfx('toggle');
    } else if (dist(at, tee) < (tool === 'tree' ? 5 : 3)) {
      chip('Too close to the tee', 'hot');
      return;
    } else {
      // Rounded to cm, as the room would see them.
      const p: Vec2 = [Math.round(at[0] * 100) / 100, Math.round(at[1] * 100) / 100];
      if (tool === 'basket') rs.baskets = [...rs.baskets, p];
      else rs.trees = [...rs.trees, rangeTree(p, Math.random)];
      sfx('confirm');
    }
    sendRange();
  }

  function cycleDisc(dir: 1 | -1): void {
    if (phase !== 'aim') return;
    const bag = bagOf(game().current);
    disc = bag[(bag.indexOf(disc) + dir + bag.length) % bag.length];
    sfx('select');
    recomputeTick();
    updateHud();
  }

  function setHyzer(dir: 1 | -1): void {
    if (phase !== 'aim') return;
    hyzer = Math.max(-1, Math.min(1, hyzer + dir * 0.25));
    sfx('select');
    recomputeTick();
    updateHud();
  }

  function toggleFP(): void {
    if (phase !== 'aim') return;
    if (autoFP()) fpOverride = !isFP();
    else { preferFP = !preferFP; fpOverride = null; }
    applyCamera(true);
    recomputeTick();
    updateHud();
  }

  function cycleView(): void {
    scene.setView(VIEWS[(VIEWS.indexOf(scene.viewMode) + 1) % VIEWS.length]);
    updateHud();
  }

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    // The hole flyover: Space or Enter skips it, other keys wait for it.
    if (intro) { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); endIntro(); } return; }
    if (e.code === 'Space') { e.preventDefault(); if (phase === 'replay') endReplay(); else if (!e.repeat) startCharge(); return; }
    const k = e.key.toLowerCase();
    if (k === '[') cycleDisc(-1);
    else if (k === ']') cycleDisc(1);
    else if (k === 'arrowleft') rotateAim(e.shiftKey ? 0.2 : 1);
    else if (k === 'arrowright') rotateAim(e.shiftKey ? -0.2 : -1);
    else if (k === 'arrowup' && isFP() && phase === 'aim') { look(0, (e.shiftKey ? 0.2 : 1) * Math.PI / 180); }
    else if (k === 'arrowdown' && isFP() && phase === 'aim') { look(0, -(e.shiftKey ? 0.2 : 1) * Math.PI / 180); }
    else if (k === 'r' && phase === 'replay') scene.resetOrbit();
    else if (k === 'w') nudgeTargetDistance(e.shiftKey ? 5 : 1);
    else if (k === 's') nudgeTargetDistance(e.shiftKey ? -5 : -1);
    else if (k === 'm' && rogue) takeMulligan();
    else if (k === 'p' && rogue && phase === 'aim' && perfectLeft[game().current] > 0) { perfectArmed = !perfectArmed; updateHud(); }
    else if (k === 'q') setHyzer(1);
    else if (k === 'e') setHyzer(-1);
    else if (k === 't') { if (phase === 'aim') { forehand = !forehand; sfx('select'); recomputeTick(); updateHud(); } }
    else if (k === 'g') cycleShot();
    else if (k === 'c') toggleFP();
    else if (k === 'v') cycleView();
    else if (k === 'f') applyCamera(true);
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });

  const swingBtn = $('swing');
  swingBtn.addEventListener('pointerdown', (e) => { swingBtn.setPointerCapture(e.pointerId); startCharge(); });
  swingBtn.addEventListener('pointerup', release);
  $('view-toggle').addEventListener('click', cycleView);
  $('fp-toggle').addEventListener('click', toggleFP);
  function cycleShot(): void {
    if (phase !== 'aim' || puttStyle()) return;
    shot = SHOTS[(SHOTS.indexOf(shot) + 1) % SHOTS.length];
    sfx('select');
    recomputeTick();
    updateHud();
  }
  $('shot').addEventListener('click', cycleShot);
  $('release').addEventListener('click', () => { if (phase === 'aim') { hyzer = hyzer >= 1 ? -1 : hyzer + 0.25; sfx('select'); recomputeTick(); updateHud(); } });

  window.addEventListener('unitschange', () => { startHoleInfo(); updateHud(); });
  const applyGraphics = () => { scene.setGraphics(prefs().graphics); $('fps').hidden = !prefs().fps; };
  applyGraphics();
  window.addEventListener('prefschange', () => { scene.setFov(prefs().fov); $('help').hidden = !prefs().help; applyGraphics(); });
  // Frame-rate readout (Settings → Show frame rate): frames counted over half-second windows.
  let fpsFrames = 0, fpsSince = performance.now();
  scene.setFov(prefs().fov);
  $('help').hidden = !prefs().help;

  // ---------- frame loop ----------
  let lastFrame = performance.now();
  /** Clone Disc: the other throw's disc, `t` samples into the flight (its path is every other sample). */
  function showTwin(t: number): void {
    const tw = flight?.e.twin;
    if (!tw || tw.length < 2) return;
    const k = Math.min(tw.length - 1, Math.floor(t / 2));
    const a = tw[Math.max(0, k - 1)], b = tw[Math.min(tw.length - 1, k + 1)];
    scene.setTwin(sampleAt(tw, t / 2), game().players[flight!.e.player].color, Math.atan2(b[1] - a[1], b[0] - a[0]));
  }

  function frameLoop(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    fpsFrames++;
    updateWindArrow();
    updateAugPanel();
    if (now - fpsSince >= 500) {
      if (!$('fps').hidden) $('fps').textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} fps`;
      fpsFrames = 0;
      fpsSince = now;
    }
    // Flight time: holding Shift fast-forwards a flight or replay.
    const ff = flight && ffHeld ? FAST_FORWARD : 1;
    $('ff-badge').hidden = ff === 1;
    if (flight && replay) replay.t += dt * 60 * REPLAY_SPEED * ff;
    else if (flight) flight.t += dt * 60 * flight.speed * ff;
    // Props clock: replays rewind to the throw's own time; live flights advance at playback speed.
    if (flight && replay) scene.updateProps(flight.clock0 + replay.t / 60, dt);
    else {
      gameClock += dt * (flight ? flight.speed * ff : 1);
      scene.updateProps(gameClock, dt);
    }
    if (intro) flyIntro(dt);
    gallery.watch(flight ? sampleAt(flight.result.samples, Math.min(replay ? replay.t : flight.t, flight.result.samples.length - 1)) : null);
    gallery.update(dt);
    effects.update(dt);
    life.update(dt, scene.eye());
    if (phase === 'charging') {
      const t = (((now - chargeStart) / 1000) * modsFor(game().current).meterSpeed) % 2;
      power = t < 1 ? t : 2 - t;
      $('meter-fill').style.width = `${power * 100}%`;
    }
    const g = game();
    const heading = (s: Vec3[], k: number) => {
      const a = s[Math.max(0, k - 1)], b = s[Math.min(s.length - 1, k + 1)];
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
    };
    COLORS.forEach((_, i) => {
      const q = g.players[i];
      scene.setDisc(i, q && !q.holed && !(flight && i === flight.e.player) ? [q.ball[0], q.ball[1], 0.02] : null, 0, yaw, i === g.current);
    });
    if (!flight?.e.twin) scene.setTwin(null, '#fff');
    sendLiveAim(now);
    // Not during the flyover: the thrower's live aim would pin the camera at the tee.
    if (phase === 'watching' && !intro) showLiveAim();
    if (flight && replay) {
      const s = flight.result.samples;
      const t = replay.t;
      const k = Math.floor(t);
      const kk = Math.min(k, s.length - 1);
      // Interpolate between samples: at 1.25× the frame advances 1 or 2 samples unevenly, which shook.
      const pos = sampleAt(s, t);
      const a = s[Math.max(0, kk - 2)], b = s[Math.min(s.length - 1, kk + 2)];
      // Keep the last real direction of travel once the disc stops (atan2(0, 0) would swing to east).
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.02) replay.heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // Ease the camera's heading so bounces and tree kicks don't whip it around.
      const dt = Math.min(0.1, (now - replay.last) / 1000);
      replay.last = now;
      const dh = Math.atan2(Math.sin(replay.heading - replay.smoothHeading), Math.cos(replay.heading - replay.smoothHeading));
      replay.smoothHeading += dh * (replay.started ? 1 - Math.exp(-dt * 5) : 1);
      scene.setDisc(flight.e.player, pos, flight.result.banks[kk] ?? 0, heading(s, kk), true);
      scene.chase(pos, replay.smoothHeading, !replay.started, dt);
      showTwin(t);
      soundUpTo(t, true);
      replay.started = true;
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      scene.setPreview(null, '#fff');
      if (k >= s.length + 30) endReplay();
    } else if (flight && following(flight)) {
      // Online: a friend's throw, ridden along live with the chase camera (no replay after).
      const s = flight.result.samples;
      const t = flight.t;
      const k = Math.floor(t), kk = Math.min(k, s.length - 1);
      const pos = sampleAt(s, t);
      const a = s[Math.max(0, kk - 2)], b = s[Math.min(s.length - 1, kk + 2)];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.02) follow.heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const dt = Math.min(0.1, (now - follow.last) / 1000);
      follow.last = now;
      const dh = Math.atan2(Math.sin(follow.heading - follow.smooth), Math.cos(follow.heading - follow.smooth));
      follow.smooth += dh * (follow.started ? 1 - Math.exp(-dt * 5) : 1);
      if (!follow.started) { scene.setFirstPerson(true); $('minimap').hidden = true; $('reticle').hidden = true; scene.minimapEnabled = false; }
      scene.setDisc(flight.e.player, pos, flight.result.banks[kk] ?? 0, heading(s, kk), true);
      scene.chase(pos, follow.smooth, !follow.started, dt);
      showTwin(t);
      soundUpTo(t, true);
      follow.started = true;
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      if (k >= s.length + 25 && phase === 'flying') endFollow();
    } else if (flight) {
      const s = flight.result.samples;
      const k = Math.floor(flight.t);
      const kk = Math.max(0, Math.min(k, s.length - 1));
      const pos = sampleAt(s, flight.t);
      scene.setDisc(flight.e.player, pos, flight.result.banks[kk] ?? 0, heading(s, kk), true);
      showTwin(flight.t);
      soundUpTo(flight.t, false);
      // First person: turn the head to follow the disc.
      if (isFP()) scene.lookToward(pos, 0.12);
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      if (k >= s.length + 25 && phase === 'flying') startReplay();
    } else if ((phase === 'aim' || phase === 'charging') && !intro) {
      const p = player();
      scene.setAim(p.ball, aimTarget, p.color); // top-down line; also drawn in the first-person minimap
      scene.setTarget3d(isFP() ? p.ball : null, aimTarget, p.color);
      // Ghost line: earned in the roguelike (fraction of the flight shown); Oracle adds the wobble spread.
      const m = modsFor(game().current);
      const pw = phase === 'charging' ? Math.max(power, 0.01) : tick;
      if (phase === 'aim' && tickStale) { recomputeTick(); $('meter-target').style.left = `${tick * 100}%`; }
      // Perfect Form armed: the throw flies exactly the ghost line, so show all of it.
      const shown = perfectArmed || (range && rs.ghost) ? 1 : m.ghost;
      const cut = (q: Vec3[]) => cutByDistance(q, shown);
      if (shown <= 0) scene.setPreview(null, p.color);
      else {
        const spread = m.ghostCone ? [-1, 1].map((k) => {
          const sigma = ((puttStyle() ? 0.5 : 1.4) * (puttStyle() ? m.puttAimError : m.aimError) * Math.PI) / 180;
          return cut(simulateThrow({ ...throwInput(pw), aim: yaw + k * sigma }, world(), () => 0.25, { ghost: true }).samples);
        }) : [];
        scene.setPreview(cut(ghost(pw).samples), p.color, spread);
      }
    } else if (!(phase === 'watching' && liveAim)) {
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      scene.setPreview(null, '#fff');
    }
    scene.render();
    requestAnimationFrame(frameLoop);
  }

  requestAnimationFrame(frameLoop);
  // Dev builds only: a handle for automated browser checks.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__satgolf = {
      scene, hole, game, pinOf, changes: () => st.changes, phase: () => phase, worldFor, trees, st, log: () => st.log, live: () => liveAim, aim: () => ({ pitch, yaw, tick }),
      gallery, effects, life, intro: () => intro, setWeather: (id: keyof typeof WEATHER) => { roundWeather = WEATHER[id]; applyWeather(); },
    };
  }
  // Joining (or rejoining) a room: replay its log, redraw this hole's throws, then carry on.
  if (net) {
    for (const x of net.log) st.apply(x.e);
    if (st.holeStarted) {
      presentHole();
      const from = st.log.map((e) => e.t).lastIndexOf('hole-start');
      for (const e of st.log.slice(from + 1)) {
        if (e.t === 'throw') { if (e.twin) scene.addTrail(e.twin, COLORS[e.player], 0.25); scene.addTrail(e.result.samples, COLORS[e.player]); }
        if (e.t === 'mulligan') scene.popTrail();
      }
    }
    net.room.on({
      event: (seq, _from, e) => {
        if (seq < known) return; // already have it
        if (seq > known) return resync(); // missed some
        known++;
        inbox.push(e);
        pump();
      },
      reject: () => resync(),
      members: (m) => membersChanged(m.map((x) => x.client)),
      live: (_from, s) => {
        // Quick chat travels the same way as live aim.
        const c = s as { chat?: unknown; player?: unknown } | null;
        if (c && typeof c.chat === 'number' && typeof c.player === 'number') {
          if (CHAT_LINES[c.chat] && opts.names[c.player]) showChat(opts.names[c.player], COLORS[c.player], c.chat);
          return;
        }
        const a = s as LiveAim | null;
        if (a && Array.isArray(a.target) && a.player === game().current && !mine(a.player) && phase === 'watching') liveAim = a;
      },
      ended: () => backToLobby(),
      // Reconnected: pick up what we missed, resend what the room didn't get.
      welcome: (w) => {
        if (!w.started) return backToLobby(); // the game ended while we were away
        for (const x of w.log) if (x.seq >= known) { known++; inbox.push(x.e); }
        for (let q = w.log.length; q < known; q++) {
          const e = sent.get(q);
          if (!e) return resync();
          net.room.sendEvent(q, e);
        }
        pump();
      },
      status: (s) => { $('status').textContent = s === 'open' ? '' : s === 'connecting' ? 'Connecting to the room…' : 'Connection lost: reconnecting…'; },
      error: (reason) => chip(/unknown message end/.test(reason) ? 'This room server is too old to go back to the lobby' : reason, 'hot'),
    });
  }
  // Dev/play-test: ?grant=0:sapling,1:the-bucket gives augments to players at the start of a run.
  if (rogue && isHost && st.log.length === 0) for (const g of (new URLSearchParams(location.search).get('grant') ?? '').split(',').filter(Boolean)) {
    const [pi, id] = g.includes(':') ? g.split(':') : ['0', g];
    const pu = byId(id);
    const i = parseInt(pi, 10);
    if (pu && mods[i]) dispatchQuiet({ t: 'grant', player: i, id: pu.id });
  }
  advance();
}
