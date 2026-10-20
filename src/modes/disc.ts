// Disc golf mode (default): a round at an OSM-mapped course with real tree canopy, local hot-seat.
import { LocalFrame, dist, distToPolyline, polylineLength, type Vec2 } from '../course/geo';
import type { SurfaceClass } from '../course/types';
import { simplify } from '../course/disc-build';
import { decodeTrees, type DiscCourseFile, type DiscHole, type Tree } from '../course/disc-types';
import { DISCS, PUTTER_DISC, suggestDisc, type Disc } from '../disc/discs';
import { BASKET, simulateThrow, type DiscWorld, type ThrowEvent, type ThrowInput, type ThrowResult } from '../disc/flight';
import { TreeIndex } from '../disc/trees';
import { effectiveMods, neutralMods, rogueStartMods, type Mods } from '../disc/mods';
import { emptyChanges, PLACE_TEXT, pinFor, place, placementQueue, pondsFor, teeFor, treesFor, type HoleChanges, type PlaceKind } from '../rogue/course';
import { byId, drawOffer, rollTier, STARTER_WEIGHTS, type Offer } from '../rogue/powerups';
import { PLAYER_COLORS } from '../game/game';
import { Round } from '../game/round';
import { SurfaceGrid } from '../game/surfaces';
import { FlatTerrain, type Vec3 } from '../game/terrain';
import { CourseScene } from '../render/courseScene';
import { loadProps } from '../render/props';
import { treeShape } from '../disc/treeShapes';
import { VIEW_LABELS, type ViewMode } from '../render/scene';
import { ESRI_ATTRIBUTION, loadImagery } from '../render/tiles';
import { convertText, fmtLen } from '../units';
import { prefs, replaysOn } from '../settings';
import { banner, chip, clearBroadcast, scoreTone, type Tone } from '../ui/broadcast';

export const DISC_COURSES = {
  simple: '/courses/tali-simple.json',
  forest: '/courses/tali.json',
  silly: '/courses/silly.json',
  fantasy: '/courses/fantasy.json',
  rainbow: '/courses/rainbow.json',
} as const;
const VIEWS: ViewMode[] = ['photo', 'overlay', 'classes'];
/** Circle 2: inside this, switch to first-person putting. */
const PUTT_RANGE = 20;
/** First person: launch = view pitch + this, so a level view gives a putt's gentle arc… */
const PUTT_LAUNCH_OFFSET = 0.12;
/** …or, for throws, the disc's own best launch angle (fast discs want it flatter). */
const launchOffset = (disc: Disc, putt: boolean) => (putt ? PUTT_LAUNCH_OFFSET : disc.launch);
const CHAIN_MID = (BASKET.trayTop + BASKET.chainTop) / 2;
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

type Phase = 'aim' | 'charging' | 'flying' | 'replay' | 'between' | 'placing';

export interface DiscOptions {
  names: string[];
  course: keyof typeof DISC_COURSES;
  /** First hole index and number of holes. */
  first: number;
  count: number;
  /** Roguelike run: draft a powerup after every hole. */
  rogue?: boolean;
}

export async function startDisc(opts: DiscOptions): Promise<void> {
  const course: DiscCourseFile = await (await fetch(DISC_COURSES[opts.course])).json();
  const trees = decodeTrees(course.trees);
  const frame = new LocalFrame(course.origin);
  const grid = SurfaceGrid.fromHole({
    bounds: course.bounds, boundary: course.boundary, features: course.features, ob: course.ob,
    trees: course.canopy.map((c, i) => ({ osm_id: `canopy/${i}`, rings: c.rings, height_m: c.height_m })),
  }, 0.5);
  const round = new Round(course.holes, opts.names, opts.first, opts.count);
  // Roguelike state per player (neutral and unused outside rogue mode).
  const rogue = !!opts.rogue;
  const mods: Mods[] = opts.names.map(() => (rogue ? rogueStartMods() : neutralMods()));
  const blocked = (q: Vec2) => { const c = grid.classAt(q[0], q[1]); return c === 'oob' || c === 'water'; };
  // Per-player tees/baskets (Forward Tee, Back Tees, Short Pin), decided when the hole is set up.
  round.setup = (hi) => {
    const h = course.holes[hi];
    return { tees: opts.names.map((_, i) => teeFor(h, mods, i, blocked)), pins: opts.names.map((_, i) => pinFor(h, mods[i])) };
  };
  round.restartHole();
  let changes: HoleChanges = emptyChanges(opts.names.length);
  /** Bumped whenever trees/ponds change, to invalidate per-player worlds. */
  let courseVersion = 0;
  const owned: string[][] = opts.names.map(() => []);
  const mulligansLeft = opts.names.map(() => 0);
  const perfectLeft = opts.names.map(() => 0);
  let perfectArmed = false;
  const removed = new Set<Tree>(); // Lumberjack: gone for everyone
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
  const shapeOf = (t: Tree) => (propTrees.has(t) ? null : treeShape(t));
  /** The course as player i plays it: their trees, their ponds, their basket. */
  const worldFor = (i: number): DiscWorld => {
    const c = worldCache.get(i);
    const pin = round.game.pins[i];
    if (c && c.v === courseVersion && c.w.basket === pin) return c.w;
    const w: DiscWorld = {
      grid, terrain: new FlatTerrain(), basket: pin, branchDensity: course.branch_density,
      trees: new TreeIndex(treesFor(trees, removed, changes, i)), hazards: pondsFor(changes, i),
      props: propColliders, clock0: gameClock, treeShape: shapeOf,
    };
    worldCache.set(i, { v: courseVersion, w });
    return w;
  };
  /** World for the current player, with moving props evaluated from the game clock now. */
  const world = () => { const w = worldFor(round.game.current); w.clock0 = gameClock; return w; };
  /** Mods acting on player i's throws: their own plus opponents' hexes. */
  const modsFor = (i: number) => effectiveMods(mods, i);
  const hole = () => round.hole as DiscHole;

  // Expected full-power flat range per disc, for disc suggestions.
  const ranges = Object.fromEntries(DISCS.map((d) => {
    const r = simulateThrow({ start: [0, 0], aim: 0, power: 1, disc: d, hyzer: 0 }, { ...world(), basket: [1e6, 1e6] }, () => 0.25, { ghost: true });
    return [d.id, dist([0, 0], r.rest)];
  }));

  const scene = new CourseScene($('stage'), course, grid, trees, PLAYER_COLORS);
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
  let aimTarget: Vec2 = hole().pin;
  let yaw = 0;
  let pitch = 0;
  let power = 0;
  let chargeStart = 0;
  let preferFP = prefs().firstPerson; // C switches (persists across turns)
  let fpOverride: boolean | null = null; // inside putting range, C overrides auto first person for this turn
  let flight: { result: ThrowResult; t0: number; speed: number; clock0: number } | null = null;
  /** Post-throw replay from a disc-chasing camera (skippable). */
  let replay: { t0: number; heading: number; smoothHeading: number; started: boolean; last: number } | null = null;
  const REPLAY_SPEED = 1.25;
  const REPLAY_MIN_SAMPLES = 40; // skip tap-ins and tiny putts
  let tick = 0; // meter tick (power to reach target)

  const game = () => round.game;
  const player = () => game().player;
  const pinOf = (i: number) => game().pins[i];
  const myPin = () => pinOf(game().current);
  const toBasket = () => dist(player().ball, myPin());
  const autoFP = () => toBasket() <= PUTT_RANGE && player().strokes > 0;
  const isFP = () => fpOverride ?? (preferFP || autoFP());
  const puttStyle = () => isFP() && disc === PUTTER_DISC && toBasket() <= PUTT_RANGE + 5;

  function startHoleInfo(): void {
    const h = hole();
    $('hole-info').innerHTML = `<div class="num">${esc(h.ref)}<small>HOLE</small></div><div class="info">
      <div class="hname">${esc(h.name ?? course.name)}</div>
      <div class="hmeta">Par ${h.par}${h.par_source === 'length' ? '<span title="No par in OSM; estimated from length">*</span>' : ''} · ${fmtLen(h.length_m)}</div>
      ${h.name ? `<div class="course">${esc(course.name)}${rogue ? ' · Crazy mode' : ''}</div>` : rogue ? '<div class="course">Crazy mode</div>' : ''}</div>`;
  }

  function startHole(): void {
    mods.forEach((m, i) => { mulligansLeft[i] = m.mulligans; perfectLeft[i] = m.perfectForm; round.capBonus[i] = m.pickupBonus; });
    round.restartHole(); // pick up this hole's per-player tees/baskets (nobody has thrown yet)
    changes = emptyChanges(opts.names.length);
    courseVersion++;
    scene.setHole(hole());
    scene.clearTrails();
    startHoleInfo();
    // Every hole starts from a flat backhand; startTurn picks the suggested disc.
    hyzer = 0;
    forehand = false;
    const queue = rogue ? placementQueue(mods) : [];
    runPlacements(queue, startTurn);
  }

  /** Show the course as player i plays it. */
  function refreshViewer(i: number): void {
    const m = modsFor(i);
    const visible = new Set(treesFor(trees, removed, { ...changes, trees: [] }, i));
    scene.setViewer({
      trees: visible,
      extras: changes.trees.filter((t) => t.owner !== i).map((t) => t.tree),
      ponds: pondsFor(changes, i),
      basketScale: m.basketScale, magnet: m.magnet,
      tee: teeFor(hole(), mods, i, blocked), pin: pinOf(i),
    });
  }

  // ---------- placement (roguelike, before each hole) ----------
  let placing: { player: number; kind: PlaceKind; rest: { player: number; kind: PlaceKind }[]; done: () => void } | null = null;

  function runPlacements(queue: { player: number; kind: PlaceKind }[], done: () => void): void {
    if (queue.length === 0) {
      placing = null;
      $('place-bar').hidden = true;
      scene.setPlacementPreview(null);
      $('hud').hidden = false;
      return done();
    }
    const [step, ...rest] = queue;
    placing = { ...step, rest, done };
    phase = 'placing';
    $('hud').hidden = true;
    // Top-down over the hole, as the placer sees it.
    scene.setFirstPerson(false);
    $('reticle').hidden = true;
    $('minimap').hidden = true;
    refreshViewer(step.player);
    scene.frame([hole().tee, hole().pin, ...hole().routing], 90, 12);
    showPlacementPreview();
    const left = queue.filter((q) => q.player === step.player && q.kind === step.kind).length;
    $('place-text').innerHTML = `<span style="color:${PLAYER_COLORS[step.player]}">●</span> <b>${esc(opts.names[step.player])}</b>: ${convertText(PLACE_TEXT[step.kind])} <small>(${left} left; click the map)</small>`;
    $('place-bar').hidden = false;
  }

  function showPlacementPreview(): void {
    if (!placing) return;
    const me = placing.player;
    scene.setPlacementPreview([
      ...changes.trees.filter((t) => t.owner === me).map((t) => ({ at: [t.tree.x, t.tree.y] as Vec2, r: t.tree.r, color: PLAYER_COLORS[me] })),
      ...changes.ponds.filter((q) => q.owner === me).map((q) => ({ at: q.c, r: q.r, color: '#4f8fcf' })),
    ]);
  }

  function placeAt(at: Vec2): void {
    if (!placing) return;
    const { player: me, kind } = placing;
    const res = place(kind, at, { hole: hole(), blocked, trees: treesFor(trees, removed, changes, me), rng: Math.random });
    if (!res.ok) { chip(res.reason, 'hot'); return; }
    if (res.kind === 'pond') changes.ponds.push({ ...res.pond, owner: me });
    else if (res.kind === 'clear-cut') changes.cleared[me].add(res.target);
    else changes.trees.push({ tree: res.tree, owner: me });
    courseVersion++;
    if (res.kind === 'clear-cut') refreshViewer(me);
    showPlacementPreview();
    const { rest, done } = placing;
    runPlacements(rest, done);
  }

  $('place-skip').addEventListener('click', () => { if (placing) runPlacements(placing.rest, placing.done); });

  /**
   * Default aim: from the fairway, the next bend of the hole line (else the basket). From the
   * woods, pitch back out: the point on the hole line ~25 m past the player's closest point.
   */
  function defaultTarget(from: Vec2): Vec2 {
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

  function startTurn(): void {
    phase = 'aim';
    power = 0;
    fpOverride = null;
    perfectArmed = false;
    refreshViewer(game().current);
    const p = player();
    aimTarget = defaultTarget(p.ball);
    yaw = Math.atan2(aimTarget[1] - p.ball[1], aimTarget[0] - p.ball[0]);
    pitch = 0;
    const d = dist(p.ball, aimTarget);
    disc = toBasket() <= PUTT_RANGE ? PUTTER_DISC : suggestDisc(d, ranges);
    applyCamera(true);
    recomputeTick();
    updateHud();
  }

  function applyCamera(reframe: boolean): void {
    const fp = isFP();
    scene.setFirstPerson(fp);
    $('reticle').hidden = !fp;
    $('minimap').hidden = !fp;
    scene.setMinimapFrame([hole().tee, myPin(), ...hole().routing, ...game().players.filter((q) => !q.holed).map((q) => q.ball)]);
    const p = player();
    if (fp) scene.setEye(p.ball, yaw, pitch);
    else if (reframe) {
      const ahead = hole().routing.filter((r) => dist(r, myPin()) < toBasket() + 1);
      scene.frame([p.ball, myPin(), ...ahead], 90, toBasket() < 40 ? 20 : 12);
    }
  }

  function throwInput(pw: number): ThrowInput {
    const fp = isFP();
    return {
      start: player().ball, aim: yaw, power: pw, disc, hyzer, mirror: forehand,
      launch: fp ? pitch + launchOffset(disc, puttStyle()) : undefined,
      style: puttStyle() ? 'putt' : 'drive',
      mods: modsFor(game().current),
      fromTee: player().strokes === 0,
    };
  }

  const ghost = (pw: number) => simulateThrow(throwInput(pw), world(), () => 0.25, { ghost: true });

  /**
   * Meter tick. Throws: the power whose ghost flight comes to rest at the target. Putts: the power
   * whose ghost crosses the target distance at mid-chain height (more power → higher there).
   */
  function recomputeTick(): void {
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

  function release(): void {
    if (phase !== 'charging') return;
    const me = game().current;
    const input = { ...throwInput(Math.max(0.01, power)), perfect: perfectArmed };
    if (perfectArmed) { perfectArmed = false; perfectLeft[me]--; }
    let result = simulateThrow(input, world());
    if (modsFor(me).clone) {
      // Clone Disc: throw twice, keep the better one.
      const twin = simulateThrow(input, world());
      if (outcomeScore(twin) < outcomeScore(result)) result = twin;
    }
    flight = { result, t0: performance.now(), speed: puttStyle() ? 1 : prefs().playback, clock0: gameClock };
    phase = 'flying';
    scene.setPreview(null, '#fff');
    updateHud();
  }

  let pendingTimer = 0;
  let undo: { idx: number; ball: Vec2; lie: SurfaceClass; strokes: number; pickedUp: boolean; lastFrom?: Vec2; current: number } | null = null;

  function startReplay(): void {
    const s = flight!.result.samples;
    if (!replaysOn() || s.length < REPLAY_MIN_SAMPLES) return finishThrow();
    phase = 'replay';
    replay = { t0: performance.now(), heading: yaw, smoothHeading: yaw, started: false, last: performance.now() };
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
    finishThrow();
  }

  function finishThrow(): void {
    const r = flight!.result;
    const idx = game().current;
    scene.addTrail(r.samples, player().color);
    flight = null;
    const pl = player();
    undo = { idx, ball: pl.ball, lie: pl.lie, strokes: pl.strokes, pickedUp: pl.pickedUp, lastFrom: pl.lastFrom, current: idx };
    game().applyShot(r);
    // Lumberjack: cut down every tree the disc touched.
    if (mods[idx].treeChopper && r.treesHit.length) {
      for (const t of r.treesHit) {
        // A planted hex tree is removed from the hole; a base tree is gone for everyone.
        const placed = changes.trees.findIndex((x) => x.tree === t);
        if (placed >= 0) changes.trees.splice(placed, 1);
        else removed.add(t);
      }
      courseVersion++;
    }
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
      shown = true;
    } else if (done.pickedUp) {
      banner({ word: 'PICKED UP', tone: 'double', who: done.name, color: done.color, what: `Hole ${hole().ref} · max ${done.strokes}`, score: fmtPar(liveToPar(idx)) });
      shown = true;
    }
    // Mulligan window: a few seconds to take the throw back (not after holing out).
    const canMull = rogue && !done.holed && mulligansLeft[idx] > 0;
    if (canMull) chip('Press M for a mulligan', 'info', `${mulligansLeft[idx]} left`, 2600);
    else undo = null;
    phase = 'between';
    updateHud();
    const wait = canMull ? 2600 : done.holed ? 2200 : shown ? 1300 : 600;
    if (game().finished) {
      round.recordCurrent();
      updateHud();
      pendingTimer = window.setTimeout(() => { undo = null; showCard(); }, Math.max(1500, wait));
    } else {
      pendingTimer = window.setTimeout(() => { undo = null; startTurn(); }, wait);
    }
  }

  function takeMulligan(): void {
    if (!undo || phase !== 'between') return;
    clearTimeout(pendingTimer);
    const u = undo;
    undo = null;
    const p = game().players[u.idx];
    Object.assign(p, { ball: u.ball, lie: u.lie, strokes: u.strokes, pickedUp: u.pickedUp, lastFrom: u.lastFrom });
    game().current = u.idx;
    mulligansLeft[u.idx]--;
    scene.popTrail();
    chip('Mulligan', 'info');
    startTurn();
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
      return `<tr><td class="player"><i style="background:${PLAYER_COLORS[p]}"></i>${esc(opts.names[p])}</td>${idx.map((i) => {
        const v = round.scores[p][i];
        return `<td>${v === undefined ? '' : mark(v, course.holes[i].par)}</td>`;
      }).join('')}<td class="tot">${round.total(p) || ''}</td><td class="pm topar ${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${fmtPar(tp)}</td></tr>`;
    });
    $('results-title').textContent = readOnly ? 'Scorecard' : last ? 'Final card' : `Hole ${hole().ref} complete`;
    $('results-table').innerHTML = head + '<tbody>' + par + rows.join('') + '</tbody>';
    $('next').hidden = readOnly || last;
    $('again').hidden = readOnly || !last;
    $('card-close').hidden = !readOnly;
    $('results').hidden = false;
    if (!readOnly) { $('hud').hidden = true; clearBroadcast(); }
  }
  $('card-close').addEventListener('click', () => { $('results').hidden = true; });
  window.addEventListener('show-scorecard', () => showCard(true));

  $('next').addEventListener('click', () => {
    $('results').hidden = true;
    if (!rogue) return advanceHole();
    // Draft in order of this hole's score (best first).
    const order = game().players.map((_, i) => i).sort((a, b) => game().players[a].strokes - game().players[b].strokes);
    runDrafts(order, advanceHole);
  });

  function advanceHole(): void {
    $('hud').hidden = false;
    if (round.nextHole()) startHole();
  }

  // ---------- roguelike draft ----------
  function runDrafts(order: number[], done: () => void, starter = false): void {
    if (order.length === 0) return done();
    const [pi, ...rest] = order;
    const players = opts.names.length;
    let offer: Offer = drawOffer(Math.random, owned[pi], 3 + mods[pi].extraCard, rollTier(Math.random, starter ? STARTER_WEIGHTS : undefined), players);
    const render = () => {
      $('draft-title').innerHTML = `<span style="color:${PLAYER_COLORS[pi]}">●</span> ${esc(opts.names[pi])}: ${starter ? 'pick your starter augment' : 'pick an augment'}`;
      $('draft-tier').textContent = `${offer.tier[0].toUpperCase()}${offer.tier.slice(1)} draft`;
      $('draft-tier').className = `tier ${offer.tier}`;
      $('draft-cards').innerHTML = offer.cards.map((c, i) => `<button class="pcard ${c.tier}" data-i="${i}">
          <span class="ptier">${c.tier}${offer.bumped === i ? ' ★ bumped' : ''}</span>
          <b>${esc(c.name)}</b><span>${esc(convertText(c.text))}</span></button>`).join('');
      $('draft-reroll').hidden = mods[pi].rerolls <= 0;
      $('draft-reroll').textContent = `Reroll (${mods[pi].rerolls})`;
      $('draft-owned').textContent = owned[pi].length ? `Have: ${owned[pi].map((id) => byId(id).name).join(', ')}` : '';
      $('draft-cards').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
        const card = offer.cards[parseInt(b.dataset.i!, 10)];
        card.apply(mods[pi]);
        owned[pi].push(card.id);
        $('draft').hidden = true;
        runDrafts(rest, done, starter);
      }));
    };
    $('draft-reroll').onclick = () => {
      if (mods[pi].rerolls <= 0) return;
      mods[pi].rerolls--;
      offer = drawOffer(Math.random, owned[pi], 3 + mods[pi].extraCard, offer.tier, players);
      render();
    };
    $('draft-skip').onclick = () => { $('draft').hidden = true; runDrafts(rest, done, starter); };
    render();
    $('draft').hidden = false;
  }
  $('again').addEventListener('click', () => location.reload());

  // ---------- HUD ----------


  function releaseLabel(): string {
    if (hyzer === 0) return 'Flat';
    const deg = Math.round(Math.abs(hyzer) * 20);
    return `${hyzer > 0 ? 'Hyzer' : 'Anhyzer'} ${deg}°`;
  }

  function updateHud(): void {
    const p = player();
    $('turn').innerHTML = `<span style="color:${p.color}">●</span> ${esc(p.name)}`;
    $('club-name').innerHTML = `${disc.name} <span class="nums">${disc.speed} | ${disc.glide} | ${disc.turn} | ${disc.fade}</span>`;
    $('release').textContent = `${releaseLabel()} · ${forehand ? 'Forehand' : 'Backhand'}`;
    const me = game().current;
    $('rogue-bar').hidden = !rogue;
    if (rogue) {
      const bits = [`⚡ ${owned[me].length} powerup${owned[me].length === 1 ? '' : 's'}`];
      if (mods[me].mulligans) bits.push(`Mulligans ${mulligansLeft[me]} (M)`);
      if (mods[me].perfectForm) bits.push(perfectArmed ? '<b>Perfect Form ARMED</b>' : `Perfect Form ${perfectLeft[me]} (P)`);
      $('rogue-bar').innerHTML = bits.join(' · ');
      $('rogue-bar').title = owned[me].map((id) => `${byId(id).name}: ${convertText(byId(id).text)}`).join('\n');
    }
    $('stats').innerHTML = `Basket <b>${fmtLen(toBasket())}</b> · Target <b>${fmtLen(dist(p.ball, aimTarget))}</b> · Lie <b>${LIE_LABELS[p.lie] ?? p.lie}</b> · Throw <b>${p.strokes + 1}</b>`;
    $('meter-fill').style.width = `${power * 100}%`;
    $('meter-target').style.left = `${tick * 100}%`;
    $('view-toggle').textContent = VIEW_LABELS[scene.viewMode];
    $('fp-toggle').textContent = isFP() ? '1st person' : 'Top-down';
    $('swing').toggleAttribute('disabled', phase !== 'aim' && phase !== 'charging');
    $('swing').innerHTML = `Hold to ${puttStyle() ? 'putt' : 'throw'} <kbd>Space</kbd>`;
    $('help').textContent = (isFP()
      ? 'Drag or arrows to aim (up/down = launch) · W/S target distance · scroll zoom · click minimap to aim · Q/E release angle · [ / ] disc · T forehand · C top-down · V view'
      : 'Click to aim · ←/→ fine aim · Q/E release angle · [ / ] disc · T forehand · C 1st person · right-drag pan · scroll zoom · V view · F re-frame')
      .replace(vector ? ' · V view' : '\u0000', '');
    const lbOrder = game().players.map((_, i) => i).sort((a, b) => liveToPar(a) - liveToPar(b));
    $('scoreboard').innerHTML = `<div class="lb-head"><span>LEADERBOARD</span><span>HOLE ${esc(hole().ref)}</span></div>` + lbOrder.map((i) => {
      const q = game().players[i];
      const tp = liveToPar(i);
      const state = q.holed ? `${scoreWord(q.strokes, hole().par)}` : q.pickedUp ? 'picked up' : `${fmtLen(dist(q.ball, pinOf(i)))} · ${LIE_LABELS[q.lie] ?? q.lie}`;
      return `<div class="row ${i === game().current && !game().finished ? 'active' : ''}"><span class="bar" style="background:${q.color}"></span><span><div class="name">${esc(q.name)}</div><div class="state">${state}</div></span><span class="strokes">${q.strokes}</span><span class="topar ${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${fmtPar(tp)}</span></div>`;
    }).join('');
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
    // Replay: drag orbits the camera around the disc (clicking doesn't skip; Space does).
    if (phase === 'replay') { drag = { x: e.clientX, y: e.clientY, mode: 'orbit' }; return; }
    if (phase === 'placing') {
      if (e.button === 0) placeAt(scene.screenToWorld(e.clientX, e.clientY));
      else drag = { x: e.clientX, y: e.clientY, mode: 'pan' };
      return;
    }
    if (isFP()) drag = { x: e.clientX, y: e.clientY, mode: 'look' };
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

  /** First person: move the target along the aim line (W/S), keeping direction. */
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

  function cycleDisc(dir: 1 | -1): void {
    if (phase !== 'aim') return;
    disc = DISCS[(DISCS.indexOf(disc) + dir + DISCS.length) % DISCS.length];
    recomputeTick();
    updateHud();
  }

  function setHyzer(dir: 1 | -1): void {
    if (phase !== 'aim') return;
    hyzer = Math.max(-1, Math.min(1, hyzer + dir * 0.25));
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
    if (e.code === 'Space') { e.preventDefault(); if (phase === 'replay') endReplay(); else if (!e.repeat) startCharge(); return; }
    const k = e.key.toLowerCase();
    if (k === '[') cycleDisc(-1);
    else if (k === ']') cycleDisc(1);
    else if (k === 'arrowleft') rotateAim(e.shiftKey ? 0.2 : 1);
    else if (k === 'arrowright') rotateAim(e.shiftKey ? -0.2 : -1);
    else if (k === 'arrowup' && isFP() && phase === 'aim') { look(0, (e.shiftKey ? 0.2 : 1) * Math.PI / 180); recomputeTick(); }
    else if (k === 'arrowdown' && isFP() && phase === 'aim') { look(0, -(e.shiftKey ? 0.2 : 1) * Math.PI / 180); recomputeTick(); }
    else if (k === 'r' && phase === 'replay') scene.resetOrbit();
    else if (k === 'w' && isFP()) nudgeTargetDistance(e.shiftKey ? 5 : 1);
    else if (k === 's' && isFP()) nudgeTargetDistance(e.shiftKey ? -5 : -1);
    else if (k === 'm' && rogue) takeMulligan();
    else if (k === 'p' && rogue && phase === 'aim' && perfectLeft[game().current] > 0) { perfectArmed = !perfectArmed; updateHud(); }
    else if (k === 'q') setHyzer(1);
    else if (k === 'e') setHyzer(-1);
    else if (k === 't') { if (phase === 'aim') { forehand = !forehand; recomputeTick(); updateHud(); } }
    else if (k === 'c') toggleFP();
    else if (k === 'v') cycleView();
    else if (k === 'f') applyCamera(true);
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });

  const swingBtn = $('swing');
  swingBtn.addEventListener('pointerdown', (e) => { swingBtn.setPointerCapture(e.pointerId); startCharge(); });
  swingBtn.addEventListener('pointerup', release);
  $('club-prev').addEventListener('click', () => cycleDisc(-1));
  $('club-next').addEventListener('click', () => cycleDisc(1));
  $('view-toggle').addEventListener('click', cycleView);
  $('fp-toggle').addEventListener('click', toggleFP);
  $('release').addEventListener('click', () => { if (phase === 'aim') { hyzer = hyzer >= 1 ? -1 : hyzer + 0.25; recomputeTick(); updateHud(); } });

  window.addEventListener('unitschange', () => { startHoleInfo(); updateHud(); });
  window.addEventListener('prefschange', () => { scene.setFov(prefs().fov); $('help').hidden = !prefs().help; });
  scene.setFov(prefs().fov);
  $('help').hidden = !prefs().help;

  // ---------- frame loop ----------
  let lastFrame = performance.now();
  function frameLoop(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    // Props clock: replays rewind to the throw's own time; live flights advance at playback speed.
    if (flight && replay) scene.updateProps(flight.clock0 + Math.max(0, (now - replay.t0) / 1000) * REPLAY_SPEED, dt);
    else {
      gameClock += dt * (flight ? flight.speed : 1);
      scene.updateProps(gameClock, dt);
    }
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
    PLAYER_COLORS.forEach((_, i) => {
      const q = g.players[i];
      scene.setDisc(i, q && !q.holed && !(flight && i === g.current) ? [q.ball[0], q.ball[1], 0.02] : null, 0, yaw, i === g.current);
    });
    if (flight && replay) {
      const s = flight.result.samples;
      const t = Math.max(0, ((now - replay.t0) / 1000) * 60 * REPLAY_SPEED);
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
      scene.setDisc(g.current, pos, flight.result.banks[kk] ?? 0, heading(s, kk), true);
      scene.chase(pos, replay.smoothHeading, !replay.started, dt);
      replay.started = true;
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      scene.setPreview(null, '#fff');
      if (k >= s.length + 30) endReplay();
    } else if (flight) {
      const s = flight.result.samples;
      const k = Math.floor(((now - flight.t0) / 1000) * 60 * flight.speed);
      // rAF's timestamp can be slightly earlier than the performance.now() taken at release.
      const kk = Math.max(0, Math.min(k, s.length - 1));
      const pos = sampleAt(s, Math.max(0, ((now - flight.t0) / 1000) * 60 * flight.speed));
      scene.setDisc(g.current, pos, flight.result.banks[kk] ?? 0, heading(s, kk), true);
      // First person: turn the head to follow the disc.
      if (isFP()) scene.lookToward(pos, 0.12);
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      if (k >= s.length + 25 && phase === 'flying') startReplay();
    } else if (phase === 'aim' || phase === 'charging') {
      const p = player();
      scene.setAim(p.ball, aimTarget, p.color); // top-down line; also drawn in the first-person minimap
      scene.setTarget3d(isFP() ? p.ball : null, aimTarget, p.color);
      // Ghost line: earned in the roguelike (fraction of the flight shown); Oracle adds the wobble spread.
      const m = modsFor(game().current);
      const pw = phase === 'charging' ? Math.max(power, 0.01) : tick;
      const cut = (q: Vec3[]) => q.slice(0, Math.max(0, Math.round(q.length * Math.min(1, m.ghost))));
      if (m.ghost <= 0) scene.setPreview(null, p.color);
      else {
        const spread = m.ghostCone ? [-1, 1].map((k) => {
          const sigma = ((puttStyle() ? 0.5 : 1.4) * (puttStyle() ? m.puttAimError : m.aimError) * Math.PI) / 180;
          return cut(simulateThrow({ ...throwInput(pw), aim: yaw + k * sigma }, world(), () => 0.25, { ghost: true }).samples);
        }) : [];
        scene.setPreview(cut(ghost(pw).samples), p.color, spread);
      }
    } else {
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
      scene, hole, game, pinOf, changes: () => changes, phase: () => phase, worldFor, trees,
    };
  }
  // Dev/play-test: ?grant=0:sapling,1:the-bucket gives augments to players at the start of a run.
  if (rogue) for (const g of (new URLSearchParams(location.search).get('grant') ?? '').split(',').filter(Boolean)) {
    const [pi, id] = g.includes(':') ? g.split(':') : ['0', g];
    const pu = byId(id);
    const i = parseInt(pi, 10);
    if (pu && mods[i]) { pu.apply(mods[i]); owned[i].push(pu.id); }
  }
  if (rogue) {
    // Starter augment before hole 1, with better odds (epic/legendary more likely).
    $('hud').hidden = true;
    const order = opts.names.map((_, i) => i);
    runDrafts(order, () => { $('hud').hidden = false; startHole(); }, true);
  } else {
    $('hud').hidden = false;
    startHole();
  }
}
