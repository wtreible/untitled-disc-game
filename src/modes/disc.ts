// Disc golf mode (default): a round at an OSM-mapped course with real tree canopy, local hot-seat.
import { LocalFrame, dist, distToPolyline, polylineLength, type Vec2 } from '../course/geo';
import { simplify } from '../course/disc-build';
import { decodeTrees, type DiscCourseFile, type Tree } from '../course/disc-types';
import { DISCS, PUTTER_DISC, suggestDisc, type Disc } from '../disc/discs';
import { FLIGHT, simulateThrow, type DiscWorld, type Shot, type ThrowInput, type ThrowResult } from '../disc/flight';
import { TreeIndex } from '../disc/trees';
import { effectiveMods } from '../disc/mods';
import { PLACE_TEXT, place, pondsFor, teeFor, treesFor } from '../rogue/course';
import { byId, drawOffer, rollTier, type Tier } from '../rogue/powerups';
import { cleanRules, tierWeights, type CrazyRules } from '../rogue/rules';
import { openAugmentBrowser, renderSidePanel } from '../ui/augments';
import { playerColors } from '../game/game';
import { DiscRound, type RoundEvent, type WireResult } from './discRound';
import { renderCard, renderSummary, type CardView } from './scorecard';
import { showBagPicker, showDraft } from './picks';
import { LiveGate, RoundSync, type NetPlay } from './discSync';
import { headingAt, newChase, stepChase, type Chase } from './chaseCam';
import { isKey, keyAction, keyFor } from '../keys';
import { guardLeave, reloadPage } from '../ui/leaveGuard';
import { SurfaceGrid } from '../game/surfaces';
import { FlatTerrain, type Vec3 } from '../game/terrain';
import { CourseScene } from '../render/courseScene';
import { loadProps } from '../render/props';
import { treeShape } from '../disc/treeShapes';
import { mountDiscPicker } from '../ui/discPicker';
import { IMAGERY, data } from '../assets';
import { VIEW_LABELS } from '../render/scene';
import { ESRI_ATTRIBUTION, loadImagery } from '../render/tiles';
import { convertText, fmtLen, fmtSpeed } from '../units';
import { flyoversOn, followOn, prefs, replaysOn } from '../settings';
import { banner, chip, clearBroadcast, scoreTone, type Tone } from '../ui/broadcast';
import { throwCues, type Cue } from '../audio/cues';
import { ambience, music, preload, rain, sfx, wind } from '../audio/sound';
import { Gallery } from '../render/gallery';
import { Effects } from '../render/effects';
import { Life } from '../render/life';
import { WEATHER, pickWeather, type Weather } from '../render/weather';
import { setTreeWind } from '../render/disc3d';
import { commentary } from '../ui/commentary';
import { EMOJI, chatMsg, mountQuickChat, type ChatMsg } from '../ui/quickChat';
import { floatEmoji } from '../ui/emojiFloat';
import { ghostKey, loadGhost, offerGhost, type GhostFlight } from '../game/ghosts';
import { ChatBubbles } from '../ui/chatBubbles';
import { mountNetStatus } from '../ui/netStatus';
import { FT, rangeConditions, rangeCourse, rangeTree, rangeWind } from '../course/range';
import { rangeMarkers } from '../render/rangeMarkers';
import { freshRange, loadRange, mountRangePanel, saveRange, type RangeTool } from '../ui/rangePanel';
import { mountTutorial, type Tutorial, type TutorialThrow } from './tutorial';
import { puttingState, renderPutting, stationBasket } from './putting';
import { $, CHAIN_MID, DISC_COURSES, EVENT_TOASTS, FAST_FORWARD, JINGLES, LIE_LABELS, PUFF, PUTT_RANGE, SHOTS, SHOT_LABELS, TRACKS, VIEWS, closestAlong, cutByDistance, drawWind, esc, fmtPar, launchOffset, meterAt, playCue, pointAlong, releaseText, sampleAt, scoreWord } from './discKit';

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
  /** The tutorial (src/modes/tutorial.ts): the range, alone, with a card of steps. */
  tutorial?: boolean;
  /** The putting ladder (src/modes/putting.ts): the range with one basket, moved back station by station. */
  putting?: boolean;
  /** Best shot: each player's team (src/game/teams.ts). */
  teams?: number[];
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
  /** Charging: ms since the charge began, as sent. Watchers run the meter from it (meterAt). */
  charge?: number;
}


export async function startDisc(opts: DiscOptions): Promise<void> {
  const range = opts.course === 'range';
  const course: DiscCourseFile = opts.course === 'range' ? rangeCourse() : await (await fetch(data(DISC_COURSES[opts.course]))).json();
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
  const st = new DiscRound(course.holes, trees, { names: opts.names, first: opts.first, count: opts.count, rogue, bag: !!opts.bag && !range, range, colors: COLORS, teams: opts.teams }, blocked);
  /** Best shot: a team's name ("Ann & Bo"), or the player's own. */
  const teamName = (p: number) => (st.teams ? st.teams[st.teamOf(p)].map((q) => opts.names[q]).join(' & ') : opts.names[p]);
  /** The rows of the leaderboard and card: one per team, or per player. Each row's first member stands for it. */
  const rows = () => (st.teams ?? opts.names.map((_, p) => [p])).map((r) => [...r]); // a copy: callers sort it
  /** A row's color: the player's, or the team's members' side by side. */
  const rowColor = (row: number[]) => (row.length === 1 ? COLORS[row[0]] : `linear-gradient(${row.map((p, k) => `${COLORS[p]} ${(k / row.length) * 100}% ${((k + 1) / row.length) * 100}%`).join(', ')})`);
  const { round, mods, owned, mulligansLeft, perfectLeft } = st;
  const net = opts.net ?? null;
  /** Away players the host is playing for until they reconnect (online). */
  const covering = new Set<number>();
  /** Players this browser controls (all of them in hot seat, and anyone the host covers). */
  const mine = (p: number) => !net || net.mine(p) || covering.has(p);
  /** Online, the host can change mid-game (the room hands it on when the host leaves). */
  let isHost = !net || net.isHost;
  /** Our events out to the room, theirs in, in order (src/modes/discSync.ts). */
  const sync = new RoundSync(st, net, {
    receive: (e) => receive(e),
    busy: (next) => phase === 'flying' || phase === 'replay' || phase === 'charging' || (phase === 'between' && next.t !== 'mulligan'),
  });
  const commit = (e: RoundEvent) => sync.commit(e);
  const sendNow = (e: RoundEvent) => sync.sendNow(e);
  const pump = () => sync.pump();
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
  /** This browser's copy (the panel edits it, saved here); the round's own is st.range. The tutorial's is fresh and calm, and not saved. */
  const putting = range && !!opts.putting;
  const rs = opts.tutorial || putting ? freshRange() : loadRange();
  // Putting: one basket at the first station, and no aim line (it would make every putt).
  if (putting) { rs.baskets = [stationBasket(0)]; rs.ghost = false; }
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
    const w = course.weather ? WEATHER[course.weather] : prefs().weather || range ? roundWeather : WEATHER.clear;
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
  let flight: { e: Extract<RoundEvent, { t: 'throw' }>; result: WireResult; t: number; speed: number; clock0: number; remote: boolean; sentEarly: boolean; show?: boolean; cues: Cue[]; cue: number; tee?: boolean; ghost?: GhostFlight | null } | null = null;
  /** Online: the current thrower's aim, as they last sent it (another player's turn only). */
  let liveAim: LiveAim | null = null;
  /** Post-throw replay from a disc-chasing camera (skippable). */
  let replay: { t: number; cam: Chase } | null = null;
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
    // The same under the first-person reticle.
    const compass = $('wind-compass');
    compass.querySelector('svg')!.style.transform = `rotate(${rot}deg)`;
    compass.classList.toggle('calm', speed < 0.5);
    compass.querySelector('b')!.textContent = label;
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
  /** At most 5 a second, on change. */
  const liveGate = new LiveGate(200);
  /**
   * Ours, while aiming or charging: on change, at most 5 a second. The meter isn't streamed: the
   * start of a charge is sent once and watchers run it themselves.
   */
  function sendLiveAim(now: number): void {
    if (!net || (phase !== 'aim' && phase !== 'charging') || !mine(game().current)) return;
    const a: LiveAim = {
      player: game().current, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), target: [+aimTarget[0].toFixed(2), +aimTarget[1].toFixed(2)],
      disc: disc.id, hyzer, forehand, shot, fp: isFP(),
    };
    if (!liveGate.pass(JSON.stringify(a) + phase, now)) return;
    if (phase === 'charging') a.charge = Math.round(now - chargeStart);
    net.room.sendLive(a);
  }

  /** Theirs as shown: eased toward each update, so 5 a second still moves smoothly. */
  let shownAim: { yaw: number; pitch: number; target: Vec2; at: number } | null = null;
  /** When their charge began, on our clock. */
  let liveChargeAt: number | null = null;
  function liveReceived(a: LiveAim): void {
    liveAim = a;
    liveChargeAt = a.charge !== undefined ? performance.now() - a.charge : null;
  }

  /** Theirs: their aim line and target, their disc and release angle, their meter, their view. */
  function showLiveAim(now: number): void {
    const a = liveAim;
    if (!a) { shownAim = null; return; }
    const turn = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    if (!shownAim || Math.abs(turn(a.yaw - shownAim.yaw)) > 1.5) shownAim = { yaw: a.yaw, pitch: a.pitch, target: [...a.target], at: now };
    else {
      const k = 1 - Math.exp(-Math.min(0.1, (now - shownAim.at) / 1000) / 0.09);
      shownAim.yaw += turn(a.yaw - shownAim.yaw) * k;
      shownAim.pitch += (a.pitch - shownAim.pitch) * k;
      shownAim.target = [shownAim.target[0] + (a.target[0] - shownAim.target[0]) * k, shownAim.target[1] + (a.target[1] - shownAim.target[1]) * k];
      shownAim.at = now;
    }
    const p = player();
    scene.setAim(p.ball, shownAim.target, p.color);
    scene.setTarget3d(isFP() ? p.ball : null, shownAim.target, p.color);
    if (isFP()) scene.setEye(p.ball, shownAim.yaw, shownAim.pitch);
    const d = DISCS.find((x) => x.id === a.disc);
    if (d) picker.update(d, a.forehand, { hyzer: a.hyzer, shot: a.shot ?? 'standard' });
    $('release').textContent = releaseText(a.hyzer, a.forehand, a.shot ?? 'standard');
    $('shot').textContent = SHOT_LABELS[a.shot ?? 'standard'];
    const fill = liveChargeAt === null ? 0 : meterAt(now - liveChargeAt, modsFor(a.player).meterSpeed);
    $('meter-fill').style.width = `${fill * 100}%`;
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
    // The putting ladder is over: its card shows the standings, and nobody throws.
    if (putting && puttState().done) { phase = 'idle'; $('hud').hidden = true; showPutting(); return; }
    phase = mine(game().current) ? 'aim' : 'watching';
    liveAim = null; shownAim = null; liveChargeAt = null;
    liveGate.reset();
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
    if (putting) { setUpPutt(R().baskets[0] ?? stationBasket(0)); showPutting(); }
    picker.setBag(st.bags[game().current]);
    gallery.clearLine(p.ball, myPin());
    // A new hole opens with its flyover (once); otherwise the camera glides to the new lie.
    const newHole = turnHole !== hole();
    turnHole = hole();
    if (newHole && !range && flyoversOn() && introFor !== hole() && game().players.every((q) => q.strokes === 0)) startIntro();
    else applyCamera(!again, !newHole);
    if (phase === 'aim') recomputeTick();
    else showWait(`${p.name} is throwing…`);
    updateHud();
  }

  /** `glide`: ease from the current view instead of cutting (same view mode only). */
  function applyCamera(reframe: boolean, glide = false): void {
    glide &&= !prefs().reduceMotion;
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
    // The camera's ground track (flyIntro: from 25 m behind the tee to 18 m short of the basket,
    // looking 45 m ahead), every 5 m: its trees are models for the whole flight.
    const track: Vec2[] = [];
    for (let s = -25; s <= len; s += 5) track.push(introAt(line, len, s));
    scene.lockTrees(track, true);
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
    const at = introAt(it.line, it.len, s);
    const ahead = pointAlong(it.line, Math.min(it.len, Math.max(0, s) + 45));
    const pin = hole().pin;
    const m = Math.max(0, Math.min(1, (k - 0.55) / 0.45));
    const look: Vec3 = [ahead[0] + (pin[0] - ahead[0]) * m, ahead[1] + (pin[1] - ahead[1]) * m, 1.2 * m];
    scene.flyCam([at[0], at[1], 24 - 14 * e], look);
    if (k >= 1) endIntro();
  }

  /** The flyover's ground point `s` m along the hole line (behind the tee when negative). */
  function introAt(line: Vec2[], len: number, s: number): Vec2 {
    const [a, b] = [line[0], line[1]];
    const L0 = dist(a, b) || 1;
    return s < 0 ? [a[0] + ((a[0] - b[0]) / L0) * -s, a[1] + ((a[1] - b[1]) / L0) * -s] : pointAlong(line, Math.min(len, s));
  }

  function endIntro(): void {
    if (!intro) return;
    intro = null;
    scene.lockTrees(null);
    $('intro').hidden = true;
    scene.minimapEnabled = true;
    if (phase !== 'aim' && phase !== 'charging' && phase !== 'watching') return;
    $('hud').hidden = false;
    applyCamera(true, true);
  }

  // ---------- fast-forward: hold Shift during a flight or replay ----------
  let ffHeld = false;
  window.addEventListener('keydown', (e) => { if (isKey(e, 'fast-forward')) ffHeld = true; });
  window.addEventListener('keyup', (e) => { if (isKey(e, 'fast-forward')) ffHeld = false; });
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

  /** Throw held while the camera was still on its way to the disc: it starts once it's there. */
  let chargeQueued = false;
  function startCharge(): void {
    if (phase !== 'aim') return;
    // Not before the camera is at the disc (it glides there from the last throw).
    if (scene.gliding) { chargeQueued = true; return; }
    chargeQueued = false;
    phase = 'charging';
    chargeStart = performance.now();
  }
  /** Let go of the throw: a throw still waiting for the camera is called off. */
  function letGo(): void {
    chargeQueued = false;
    release();
  }
  window.addEventListener('blur', () => { chargeQueued = false; });

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
    if (tutorial) tutorialShot = { power: input.power, hyzer, forehand, shot: input.shot ?? 'standard', putt: input.style === 'putt' };
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
    // Our tee shot: this browser's best on the hole flies alongside (Settings → Ghost disc).
    if (!remote && ghostsOn() && game().players[e.player].strokes === 0) {
      flight.tee = true;
      flight.ghost = loadGhost(ghostKey(opts.course, hole().ref));
    }
    endIntro();
    gallery.onThrow(e.result.samples);
    sfx('swish', { gain: remote ? 0.5 : 0.8 });
    if (following(flight)) flight.speed = REPLAY_SPEED; // ridden along at replay pace
    follow = newChase(e.result.samples);
    scene.lockTrees(e.result.samples.map((q): Vec2 => [q[0], q[1]])); // no tree LOD changes while following it
    liveAim = null; shownAim = null; liveChargeAt = null;
    phase = 'flying';
    scene.setPreview(null, '#fff');
    updateHud();
  }

  /** Settings → Gameplay → Ghost disc: real holes as they are (not Crazy mode's, the range or the tutorial). */
  const ghostsOn = () => prefs().ghosts && !rogue && !range && !opts.tutorial;
  /** Settings → Gameplay → Quick turns: playing alone (hot seat with one player, no room). */
  const quickSolo = () => !net && opts.names.length === 1 && !opts.tutorial && prefs().quickSolo;
  /** Live chase camera for a friend's throw (online, Settings → Follow friends' throws). */
  let follow: Chase = newChase([[0, 0, 0]]);
  const following = (f: NonNullable<typeof flight>) => f.remote && !f.show && !!net && followOn();
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
    if (!flight!.show && (!replaysOn() || quickSolo() || s.length < REPLAY_MIN_SAMPLES)) return finishThrow();
    phase = 'replay';
    replay = { t: 0, cam: newChase(s) };
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
    const { e, remote, sentEarly, tee, ghost } = flight!;
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
    // Best shot: the team's volley is done; whose throw it plays from now (if there was a choice).
    const vol = st.resolved;
    if (st.teams && vol && vol.team === st.teamOf(idx) && st.teams[vol.team].length > 1 && !done.holed) chip(`${teamName(idx)} play ${opts.names[vol.best]}’s throw`, 'info');
    // A tee shot against its ghost: how the ghost did, and whether this one takes its place.
    if (tee) {
      const best = !r.penalty && offerGhost(ghostKey(opts.course, hole().ref), r.samples, r.rest, pinOf(idx), r.holed); // OB or water never counts
      if (ghost) chip(best ? 'New best tee shot' : `Ghost: ${ghost.holed ? 'in the basket' : `${fmtLen(ghost.off)} out`}`, best ? 'birdie' : 'info');
    }
    // Broadcast graphics: a chip per distinct event, a result banner when someone holes out.
    const msgs = [...(r.propHits ?? []).map((t) => propToasts.get(t) ?? 'Bonk!'), ...r.events.map((e) => course.toasts?.[e] ?? EVENT_TOASTS[e])]
      .filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
    const eventTone = (m: string): Tone => (/OB|Splash|\+1/.test(m) ? 'bogey' : /Saved|Magnet|Phased/.test(m) ? 'info' : 'hot');
    if (!done.holed) for (const m of msgs) chip(m, eventTone(m));
    let shown = msgs.length > 0;
    if (done.holed) {
      const par = hole().par;
      banner({
        word: scoreWord(done.strokes, par).toUpperCase(), tone: scoreTone(done.strokes, par), who: teamName(idx), color: done.color,
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
      banner({ word: 'PICKED UP', tone: 'double', who: teamName(idx), color: done.color, what: `Hole ${hole().ref} · max ${done.strokes}`, score: fmtPar(liveToPar(idx)) });
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
    // Quick turns (solo): the next throw is ready almost at once (a hole-out still gets its moment).
    const wait = canMull ? 2600 : done.holed ? (quickSolo() ? 1200 : 2200) : quickSolo() ? 250 : shown ? 1300 : 600;
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
    if (tutorial && tutorialShot && !remote) { tutorial.thrown({ ...tutorialShot, holed: r.holed }); tutorialShot = null; }
    showPutting();
    phase = 'between';
    updateHud();
    pendingTimer = window.setTimeout(() => { phase = 'idle'; advance(); }, r.holed ? 1400 : quickSolo() ? 250 : 900);
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

  // ---------- scorecard ----------
  /** What the card shows (src/modes/scorecard.ts). */
  const cardView = (): CardView => ({
    holes: course.holes, round, names: opts.names, colors: COLORS, toPar: liveToPar, augments: rogue ? owned : null,
    teams: st.teams ? { rows: rows(), name: teamName, color: rowColor } : undefined,
  });
  /** Hole card, or (readOnly, from the pause menu) a mid-round look with just a Close button. */
  function showCard(readOnly = false): void {
    const last = round.isLastHole;
    renderCard(cardView());
    renderSummary(last && game().finished, st.log, cardView(), watchShot);
    $('results-title').textContent = readOnly ? 'Scorecard' : last ? 'Final card' : `Hole ${hole().ref} complete`;
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

  // ---------- highlights (final card): replay a throw from the log ----------
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
    showBagPicker({
      name: opts.names[pi], color: COLORS[pi], size, pocket: !!st.bags[pi], pick,
      done: (discs) => {
        if (!st.needBag.includes(pi)) return;
        bagDraft.delete(pi);
        $('bag').hidden = true;
        dispatch({ t: 'bag', player: pi, discs });
      },
    });
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
    const offer = st.offer!;
    sfx('deal');
    showDraft({
      name: opts.names[pi], color: COLORS[pi], starter: st.starter, tier: offer.tier, cards: offer.cards, bumped: offer.bumped,
      rerolls: mods[pi].rerolls, owned: owned[pi],
      pick: (i) => {
        if (st.drafting[0] !== pi) return;
        dispatch({ t: 'pick', player: pi, id: st.offer!.cards[i] });
      },
      reroll: () => {
        if (st.drafting[0] !== pi || mods[pi].rerolls <= 0) return;
        const tier = st.offer!.tier;
        dispatchQuiet({ t: 'reroll', player: pi });
        deal(pi, tier);
        renderDraft(pi);
      },
      skip: () => { if (st.drafting[0] === pi) dispatch({ t: 'pick', player: pi, id: null }); },
    });
  }
  $('again').addEventListener('click', () => {
    if (net) { if (isHost) net.room.end(); return; } // the room's 'ended' brings everyone back, us too
    reloadPage();
  });
  $('leave').addEventListener('click', () => {
    net?.room.close();
    try { localStorage.removeItem('untitled-disc-game:room'); } catch { /* storage unavailable */ } // left: its link asks for a name again
    history.replaceState(null, '', location.pathname + location.search);
    reloadPage();
  });
  // Online host: end the game early (the range never ends on its own).
  $('pause-lobby').hidden = !net || !isHost;
  $('pause-lobby').addEventListener('click', () => {
    if (net && isHost && confirm('End this game and take everyone back to the lobby?')) net.room.end();
  });
  /**
   * The room handed hosting on (the host left), maybe to us: the host's jobs are starting holes,
   * moving past scorecards, ending the game and playing for away players.
   */
  function hostChanged(now: boolean): void {
    if (!net || now === isHost) return;
    isHost = now;
    if (!isHost) covering.clear();
    else chip('You are the host now', 'info');
    $('pause-lobby').hidden = !isHost;
    if (st.stage === 'card' && !$('results').hidden) showCard();
    else if (st.stage === 'need-hole' || st.stage === 'need-rules') advance();
    updateAway();
  }
  /** The room is back in its lobby: reload into it (the menu rejoins the room it last joined without asking names). */
  function backToLobby(): void {
    if (!net) return;
    net.room.close();
    reloadPage(); // the address still has #room=CODE
  }

  // ---------- HUD ----------


  function updateHud(): void {
    const p = player();
    $('turn').innerHTML = `<span style="color:${p.color}">●</span> ${esc(p.name)}`;
    picker.update(disc, forehand, { hyzer, shot: puttStyle() ? 'standard' : shot });
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
    // The wobble zone: throws only (putts don't), and gone with Run-Up or Golden Arm.
    $('meter-wobble').style.left = `${FLIGHT.wobbleFrom * 100}%`;
    $('meter-wobble').hidden = puttStyle() || modsFor(game().current).noOverpowerWobble;
    $('view-toggle').textContent = VIEW_LABELS[scene.viewMode];
    $('fp-toggle').textContent = isFP() ? '1st person' : 'Top-down';
    $('swing').toggleAttribute('disabled', phase !== 'aim' && phase !== 'charging');
    $('swing').innerHTML = `Hold to ${puttStyle() ? 'putt' : 'throw'} <kbd>${keyFor('throw')}</kbd>`;
    // Written from the current keys (Settings → Controls).
    const k = keyFor, two = (a: Parameters<typeof keyFor>[0], b: Parameters<typeof keyFor>[0]) => `${k(a)}/${k(b)}`;
    const common = `${two('target-farther', 'target-closer')} target distance · ${two('hyzer', 'anhyzer')} release angle · ${k('disc-prev')} / ${k('disc-next')} disc · ${k('forehand')} forehand · ${k('shot')} shot`;
    const view = vector ? '' : ` · ${k('view')} view`;
    $('help').textContent = isFP()
      ? `Drag or ${two('aim-left', 'aim-right')} to aim (${two('look-up', 'look-down')} = launch) · ${common} · scroll zoom · click minimap to aim · ${k('first-person')} top-down${view}`
      : `Click to aim · ${two('aim-left', 'aim-right')} fine aim · ${common} · ${k('first-person')} 1st person · right-drag pan · scroll zoom${view} · ${k('reframe')} re-frame`;
    if (range) { rangeBoard(); return; }
    // One row a player, or a team in best shot (its members are always on the same spot and score).
    const lbOrder = rows().sort((a, b) => liveToPar(a[0]) - liveToPar(b[0]));
    $('scoreboard').innerHTML = `<div class="lb-head"><span>LEADERBOARD</span><span>HOLE ${esc(hole().ref)}</span></div>` + lbOrder.map((row) => {
      const i = row[0];
      const q = game().players[i];
      const tp = liveToPar(i);
      const state = q.holed ? `${scoreWord(q.strokes, hole().par)}` : q.pickedUp ? 'picked up' : `${fmtLen(dist(q.ball, pinOf(i)))} · ${LIE_LABELS[q.lie] ?? q.lie}`;
      return `<div class="row ${row.includes(game().current) && !game().finished ? 'active' : ''}"><span class="bar" style="background:${rowColor(row)}"></span><span><div class="name">${esc(teamName(i))}</div><div class="state">${state}</div></span><span class="strokes">${q.strokes}</span><span class="topar ${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${fmtPar(tp)}</span></div>`;
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
    // Best shot: the current team's other throwers first, then the other teams (by name).
    if (st.teams) {
      const t = st.teamOf(game().current), v = st.volley.get(t) ?? [];
      const mates = st.teams[t].filter((p) => p !== game().current && !v.some((x) => x.player === p));
      const teams = [...new Set(game().order().map((p) => st.teamOf(p)))].filter((k) => k !== t);
      const items = [...mates.map((p) => ({ name: opts.names[p], color: COLORS[p] })), ...teams.map((k) => ({ name: teamName(st.teams![k][0]), color: COLORS[st.teams![k][0]] }))].slice(0, 3);
      return items.length ? `<div class="lb-next"><small>UP NEXT</small>${items.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('›')}</div>` : '';
    }
    const next = game().order().filter((i) => i !== game().current).slice(0, 3);
    if (!next.length) return '';
    return `<div class="lb-next"><small>UP NEXT</small>${next.map((i) => `<span><i style="background:${COLORS[i]}"></i>${esc(opts.names[i])}</span>`).join('›')}</div>`;
  }

  // ---------- input ----------
  const canvas = scene.renderer.domElement;
  /** The scorecard is up while its key is held. */
  let heldCard = false;
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
      const k = 0.0025 * prefs().lookSpeed; // Settings → Camera: look speed, invert
      look(-(e.clientX - drag.x) * k, (prefs().invertLook ? 1 : -1) * (e.clientY - drag.y) * k);
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
  /** Speech bubbles over each player's disc (their basket once they've holed out). */
  const bubbles = new ChatBubbles($('chat-bubbles'), (p) => {
    const q = game().players[p];
    if (!q) return null;
    const at = q.holed ? pinOf(p) : q.ball;
    return [at[0], at[1], 1.9];
  }, (q) => scene.project(q));
  const chatSay = (p: number, m: ChatMsg) => {
    bubbles.say(p, opts.names[p], COLORS[p], m);
    if ('emoji' in m) floatEmoji(EMOJI[m.emoji]); // and up the screen (src/ui/emojiFloat.ts)
  };
  mountQuickChat((m) => {
    const p = chatter();
    chatSay(p, m);
    net?.room.sendLive({ ...m, player: p });
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
      scene.frame([hole().tee, [0, 400 * FT], ...R().baskets, ...R().trees.map((q): Vec2 => [q.x, q.y])], 60, 12, !prefs().reduceMotion);
      updateHud();
    },
    clearLines: () => scene.clearTrails(),
    reset: () => {
      rs.baskets = freshRange().baskets;
      rs.trees = [];
      sendRange();
    },
  }) : null;
  $('range-panel').hidden = !range || !!opts.tutorial || putting;

  // ---------- putting ladder: stations, putts and scores (src/modes/putting.ts) ----------
  /** Throws before this belong to an earlier ladder (Play again, in hot seat). */
  let puttFrom = 0;
  const puttState = () => puttingState(st.log, opts.names.length, puttFrom);
  /** A putt: the putter, a flat backhand, a normal shot, in first person, aimed at the basket. */
  function setUpPutt(basket: Vec2): void {
    disc = PUTTER_DISC; hyzer = 0; forehand = false; shot = 'standard';
    fpOverride = true;
    const b = player().ball;
    aimTarget = basket;
    yaw = Math.atan2(basket[1] - b[1], basket[0] - b[0]);
    pitch = 0;
    recomputeTick();
  }
  function showPutting(): void {
    if (!putting) return;
    const s = puttState();
    renderPutting($('putting'), s, opts.names, COLORS, {
      // Hot seat: go again at once. Online: the host takes everyone back to the room's lobby.
      again: net ? undefined : () => { puttFrom = st.log.filter((e) => e.t === 'throw').length; showPutting(); advance(); },
      lobby: net && isHost ? () => net.room.end() : undefined,
      wait: net && !isHost && s.done ? 'Waiting for the host…' : undefined,
      quit: () => (net ? $('leave').click() : reloadPage()),
    });
  }
  showPutting();

  // ---------- tutorial: a card of steps over the range ----------
  /** Baskets a tutorial step asked for, placed once it's our turn to set the range. */
  let tutorialBaskets: { at: Vec2[]; putt: boolean } | null = null;
  /** The throw in the air, as the tutorial wants to hear of it when it lands. */
  let tutorialShot: Omit<TutorialThrow, 'holed'> | null = null;
  const tutorial: Tutorial | null = opts.tutorial ? mountTutorial($('tutorial'), {
    setBaskets: (b, putt) => { tutorialBaskets = { at: b.map((q): Vec2 => [q[0], q[1]]), putt }; },
    quit: () => reloadPage(),
  }) : null;
  $('pause-card').hidden = range;

  /**
   * The panel changed our copy of the range: if it's ours to set, save it and send it to everyone
   * (it applies here too); if not, put the round's back.
   */
  function sendRange(): void {
    if (!canSetRange()) { presentRange(); return; }
    if (!opts.tutorial && !putting) saveRange(rs);
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
    // Hold for the scorecard (not on the range, which has none; not over a card already up).
    if (isKey(e, 'scorecard')) {
      e.preventDefault();
      if (!e.repeat && !range && $('results').hidden && $('setup').hidden) { showCard(true); heldCard = true; }
      return;
    }
    // The hole flyover: Space or Enter skips it, other keys wait for it.
    if (intro) { if (isKey(e, 'throw') || e.key === 'Enter') { e.preventDefault(); endIntro(); } return; }
    if (isKey(e, 'throw')) { e.preventDefault(); if (phase === 'replay') endReplay(); else if (!e.repeat) startCharge(); return; }
    const fine = e.shiftKey; // Shift: finer aim, bigger target steps
    switch (keyAction(e)) {
      case 'disc-prev': cycleDisc(-1); break;
      case 'disc-next': cycleDisc(1); break;
      case 'aim-left': rotateAim(fine ? 0.2 : 1); break;
      case 'aim-right': rotateAim(fine ? -0.2 : -1); break;
      case 'look-up': if (isFP() && phase === 'aim') look(0, (fine ? 0.2 : 1) * Math.PI / 180); break;
      case 'look-down': if (isFP() && phase === 'aim') look(0, -(fine ? 0.2 : 1) * Math.PI / 180); break;
      case 'replay-reset': if (phase === 'replay') scene.resetOrbit(); break;
      case 'target-farther': nudgeTargetDistance(fine ? 5 : 1); break;
      case 'target-closer': nudgeTargetDistance(fine ? -5 : -1); break;
      case 'mulligan': if (rogue) takeMulligan(); break;
      case 'perfect': if (rogue && phase === 'aim' && perfectLeft[game().current] > 0) { perfectArmed = !perfectArmed; updateHud(); } break;
      case 'hyzer': setHyzer(1); break;
      case 'anhyzer': setHyzer(-1); break;
      case 'forehand': if (phase === 'aim') { forehand = !forehand; sfx('select'); recomputeTick(); updateHud(); } break;
      case 'shot': cycleShot(); break;
      case 'first-person': toggleFP(); break;
      case 'view': cycleView(); break;
      case 'reframe': applyCamera(true); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (isKey(e, 'throw')) letGo();
    if (isKey(e, 'scorecard') && heldCard) { heldCard = false; $('results').hidden = true; }
  });
  window.addEventListener('blur', () => { if (heldCard) { heldCard = false; $('results').hidden = true; } });

  const swingBtn = $('swing');
  swingBtn.addEventListener('pointerdown', (e) => { swingBtn.setPointerCapture(e.pointerId); startCharge(); });
  swingBtn.addEventListener('pointerup', letGo);
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
    $('wind-compass').hidden = $('reticle').hidden; // with the reticle: first person, lining up
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
    // A live flight sends spectators running as it nears them; a replay just has them watch.
    gallery.watch(flight ? sampleAt(flight.result.samples, Math.min(replay ? replay.t : flight.t, flight.result.samples.length - 1)) : null, flight && !replay ? flight.t : undefined, flight ? 60 * flight.speed * ff : 60);
    gallery.update(dt);
    effects.update(dt);
    life.update(dt, scene.eye());
    // Putting: whoever's up moves the basket back when a station's done (everyone sees it come).
    if (putting && phase === 'aim' && canSetRange()) {
      const want = stationBasket(puttState().station), b = R().baskets;
      if (b.length !== 1 || dist(b[0], want) > 0.05) {
        rs.baskets = [want];
        sendRange();
        setUpPutt(want);
        if (isFP()) scene.setEye(player().ball, yaw, pitch);
      }
    }
    if (tutorial && phase === 'aim') {
      if (tutorialBaskets && canSetRange()) {
        const { at, putt } = tutorialBaskets;
        tutorialBaskets = null;
        rs.baskets = at;
        sendRange();
        if (putt && at.length) {
          // The putt step: the putter, a flat backhand, a normal shot, aimed at the basket.
          disc = PUTTER_DISC; hyzer = 0; forehand = false; shot = 'standard';
          setAimTarget(at[0]);
          if (isFP()) scene.setEye(player().ball, yaw, pitch);
        }
      }
      const b = player().ball;
      tutorial.aim({ angle: Math.atan2(aimTarget[1] - b[1], aimTarget[0] - b[0]), dist: dist(b, aimTarget), disc: disc.id, firstPerson: isFP() });
    }
    if (chargeQueued && phase === 'aim' && !scene.gliding) startCharge();
    else if (phase !== 'aim') chargeQueued = false;
    if (phase === 'charging') {
      power = meterAt(now - chargeStart, modsFor(game().current).meterSpeed);
      $('meter-fill').style.width = `${power * 100}%`;
    }
    const g = game();
    COLORS.forEach((_, i) => {
      const q = g.players[i];
      // Best shot: a throw waiting on its teammates' sits where it landed.
      const at = st.teams ? st.volley.get(st.teamOf(i))?.find((x) => x.player === i)?.result.rest ?? q?.ball : q?.ball;
      scene.setDisc(i, q && at && !q.holed && !(flight && i === flight.e.player) ? [at[0], at[1], 0.02] : null, 0, yaw, i === g.current);
    });
    if (!flight?.e.twin) scene.setTwin(null, '#fff');
    // The ghost disc, at the same moment of its own flight (in the replay too).
    const gh = flight?.ghost;
    if (gh && gh.samples.length > 1) {
      const t = Math.min(replay ? replay.t : flight!.t, gh.samples.length - 1);
      scene.setGhost(sampleAt(gh.samples, t), headingAt(gh.samples, Math.floor(t)));
    } else scene.setGhost(null);
    sendLiveAim(now);
    bubbles.update();
    // Not during the flyover: the thrower's live aim would pin the camera at the tee.
    if (phase === 'watching' && !intro) showLiveAim(now);
    if (flight && replay) {
      const s = flight.result.samples;
      const t = replay.t, cam = replay.cam;
      const k = Math.floor(t);
      const { pos, kk, dt } = stepChase(cam, s, t, now);
      scene.setDisc(flight.e.player, pos, flight.result.banks[kk] ?? 0, headingAt(s, kk), true);
      scene.chase(pos, cam.smooth, !cam.started, dt);
      showTwin(t);
      soundUpTo(t, true);
      cam.started = true;
      scene.setAim(null, [0, 0], '#fff');
      scene.setTarget3d(null, [0, 0], '#fff');
      scene.setPreview(null, '#fff');
      if (k >= s.length + 30) endReplay();
    } else if (flight && following(flight)) {
      // Online: a friend's throw, ridden along live with the chase camera (no replay after).
      const s = flight.result.samples;
      const t = flight.t;
      const k = Math.floor(t);
      const { pos, kk, dt } = stepChase(follow, s, t, now);
      if (!follow.started) { scene.setFirstPerson(true); $('minimap').hidden = true; $('reticle').hidden = true; scene.minimapEnabled = false; }
      scene.setDisc(flight.e.player, pos, flight.result.banks[kk] ?? 0, headingAt(s, kk), true);
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
      scene.setDisc(flight.e.player, pos, flight.result.banks[kk] ?? 0, headingAt(s, kk), true);
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
    (window as unknown as Record<string, unknown>).__udg = {
      scene, hole, game, pinOf, changes: () => st.changes, phase: () => phase, worldFor, trees, st, log: () => st.log, live: () => liveAim, aim: () => ({ pitch, yaw, tick }),
      gallery, effects, life, intro: () => intro, setWeather: (id: keyof typeof WEATHER) => { roundWeather = WEATHER[id]; applyWeather(); },
    };
  }
  // Joining (or rejoining) a room: replay its log, redraw this hole's throws, then carry on.
  /** Online: the connection's dot and round trip in the top bar. */
  const netStatus = mountNetStatus($('net-status'));
  if (net) { netStatus.status('open'); if (net.room.lastPing !== null) netStatus.ping(net.room.lastPing); } else $('net-status').hidden = true;
  /** The room's game we're in (a reconnect into a different one goes back to the lobby). */
  const game0 = net?.room.game ?? '';
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
      event: (seq, _from, e) => sync.received(seq, e),
      reject: () => sync.resync(),
      members: (m) => membersChanged(m.map((x) => x.client)),
      live: (_from, s) => {
        // Quick chat (lines and emoji) travels the same way as live aim.
        const c = s as { chat?: unknown; emoji?: unknown; player?: unknown } | null;
        if (c && (c.chat !== undefined || c.emoji !== undefined)) {
          const m = chatMsg(c);
          if (m && typeof c.player === 'number' && opts.names[c.player]) chatSay(c.player, m);
          return;
        }
        const a = s as LiveAim | null;
        if (a && Array.isArray(a.target) && a.player === game().current && !mine(a.player) && phase === 'watching') liveReceived(a);
      },
      ended: () => backToLobby(),
      host: (h) => hostChanged(h === net.room.id),
      // Reconnected: pick up what we missed, resend what the room didn't get.
      welcome: (w) => {
        if (!w.started || (w.game && game0 && w.game !== game0)) return backToLobby(); // the game ended while we were away
        hostChanged(w.host === w.you);
        sync.caughtUp(w);
      },
      status: (s) => { netStatus.status(s); $('status').textContent = s === 'open' ? '' : s === 'connecting' ? 'Connecting to the room…' : 'Connection lost: reconnecting…'; },
      ping: (ms) => netStatus.ping(ms),
      error: (reason) => chip(/unknown message end/.test(reason) ? 'This room server is too old to go back to the lobby' : reason, 'hot'),
    });
  }
  // Settings → Gameplay: the browser asks before leaving a round that's on (not the range or the
  // tutorial, nor once the final card is up).
  guardLeave(() => !range && !opts.tutorial && st.log.length > 0 && !(round.isLastHole && game().finished));
  // Dev/play-test: ?grant=0:sapling,1:the-bucket gives augments to players at the start of a run.
  if (rogue && isHost && st.log.length === 0) for (const g of (new URLSearchParams(location.search).get('grant') ?? '').split(',').filter(Boolean)) {
    const [pi, id] = g.includes(':') ? g.split(':') : ['0', g];
    const pu = byId(id);
    const i = parseInt(pi, 10);
    if (pu && mods[i]) dispatchQuiet({ t: 'grant', player: i, id: pu.id });
  }
  advance();
}
