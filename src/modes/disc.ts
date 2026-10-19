// Disc golf mode (default): a round at an OSM-mapped course with real tree canopy, local hot-seat.
import { LocalFrame, dist, distToPolyline, polylineLength, type Vec2 } from '../course/geo';
import { decodeTrees, type DiscCourseFile, type DiscHole } from '../course/disc-types';
import { DISCS, PUTTER_DISC, suggestDisc, type Disc } from '../disc/discs';
import { BASKET, simulateThrow, type DiscWorld, type ThrowEvent, type ThrowInput, type ThrowResult } from '../disc/flight';
import { TreeIndex } from '../disc/trees';
import { PLAYER_COLORS } from '../game/game';
import { Round } from '../game/round';
import { SurfaceGrid } from '../game/surfaces';
import { FlatTerrain, type Vec3 } from '../game/terrain';
import { CourseScene } from '../render/courseScene';
import { VIEW_LABELS, type ViewMode } from '../render/scene';
import { ESRI_ATTRIBUTION, loadImagery } from '../render/tiles';

export const DISC_COURSE_URL = '/courses/tali.json';
const VIEWS: ViewMode[] = ['photo', 'overlay', 'classes'];
const PLAYBACK = 1.5;
/** Circle 2: inside this, switch to first-person putting. */
const PUTT_RANGE = 20;
const PUTT_LAUNCH_OFFSET = 0.12;
const CHAIN_MID = (BASKET.trayTop + BASKET.chainTop) / 2; // launch angle = view pitch + this, so a level view gives a putt's gentle arc
const LIE_LABELS: Record<string, string> = {
  tee: 'Tee pad', fairway: 'Fairway', rough: 'Open', trees: 'Woods', bunker: 'Sand', green: 'Basket', path: 'Path', water: 'Water', oob: 'OB',
};
const EVENT_TOASTS: Partial<Record<ThrowEvent, string>> = {
  trunk: 'Tree!', branch: 'Kicked by branches', spit: 'Spit out!', cut: 'Cut through the chains', band: 'Top band!',
  tray: 'Off the cage', pole: 'Pole hit', water: 'Splash! +1', oob: 'OB! +1',
};

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

type Phase = 'aim' | 'charging' | 'flying' | 'between';

export interface DiscOptions {
  names: string[];
  /** First hole index and number of holes. */
  first: number;
  count: number;
}

export async function startDisc(opts: DiscOptions): Promise<void> {
  const course: DiscCourseFile = await (await fetch(DISC_COURSE_URL)).json();
  const trees = decodeTrees(course.trees);
  const frame = new LocalFrame(course.origin);
  const grid = SurfaceGrid.fromHole({
    bounds: course.bounds, boundary: course.boundary, features: course.features, ob: course.ob,
    trees: course.canopy.map((c, i) => ({ osm_id: `canopy/${i}`, rings: c.rings, height_m: c.height_m })),
  }, 0.5);
  const treeIndex = new TreeIndex(trees);
  const round = new Round(course.holes, opts.names, opts.first, opts.count);
  const world = (): DiscWorld => ({ grid, terrain: new FlatTerrain(), trees: treeIndex, basket: round.hole.pin });
  const hole = () => round.hole as DiscHole;

  // Expected full-power flat range per disc, for disc suggestions.
  const ranges = Object.fromEntries(DISCS.map((d) => {
    const r = simulateThrow({ start: [0, 0], aim: 0, power: 1, disc: d, hyzer: 0 }, { ...world(), basket: [1e6, 1e6] }, () => 0.25, { ghost: true });
    return [d.id, dist([0, 0], r.rest)];
  }));

  const scene = new CourseScene($('stage'), course, grid, trees, PLAYER_COLORS);
  $('attribution').textContent = [ESRI_ATTRIBUTION, ...course.source.attribution].join(' · ');
  $('status').textContent = 'Loading imagery…';
  const maxTex = Math.min(8192, scene.renderer.capabilities.maxTextureSize);
  loadImagery(frame, course.bounds, 19, maxTex)
    .then((img) => {
      scene.setImagery(img, course.imagery_offset_m);
      $('status').textContent = img.failedTiles ? `${img.failedTiles} imagery tiles failed to load` : '';
    })
    .catch((e) => { $('status').textContent = `Imagery unavailable (${e.message}); showing classes`; });

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
  let fpOverride: boolean | null = null; // user toggle for this turn
  let flight: { result: ThrowResult; t0: number; speed: number } | null = null;
  let tick = 0; // meter tick (power to reach target)

  const game = () => round.game;
  const player = () => game().player;
  const toBasket = () => dist(player().ball, hole().pin);
  const autoFP = () => toBasket() <= PUTT_RANGE && player().strokes > 0;
  const isFP = () => fpOverride ?? autoFP();
  const puttStyle = () => isFP() && disc === PUTTER_DISC && toBasket() <= PUTT_RANGE + 5;

  function startHole(): void {
    scene.setHole(hole());
    scene.clearTrails();
    const h = hole();
    $('hole-info').innerHTML = `<b>${esc(course.name)}</b><br>Hole ${h.ref} · Par ${h.par}${h.par_source === 'length' ? '<span title="No par in OSM; estimated from length"> (est.)</span>' : ''} · ${Math.round(h.length_m)} m`;
    startTurn();
  }

  /**
   * Default aim: from the fairway, the next bend of the hole line (else the basket). From the
   * woods, pitch back out: the point on the hole line ~25 m past the player's closest point.
   */
  function defaultTarget(from: Vec2): Vec2 {
    const h = hole();
    const dB = dist(from, h.pin);
    if (dB > PUTT_RANGE && distToPolyline(from, h.routing) > 6) {
      const along = closestAlong(from, h.routing) + 25;
      const total = polylineLength(h.routing);
      return along >= total ? h.pin : pointAlong(h.routing, along);
    }
    for (const p of h.routing.slice(1, -1)) if (dist(p, h.pin) < dB - 20 && dist(from, p) > 30) return p;
    return h.pin;
  }

  function startTurn(): void {
    phase = 'aim';
    power = 0;
    fpOverride = null;
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
    const p = player();
    if (fp) scene.setEye(p.ball, yaw, pitch);
    else if (reframe) {
      const ahead = hole().routing.filter((r) => dist(r, hole().pin) < toBasket() + 1);
      scene.frame([p.ball, hole().pin, ...ahead], 90, toBasket() < 40 ? 20 : 12);
    }
  }

  function throwInput(pw: number): ThrowInput {
    const fp = isFP();
    return {
      start: player().ball, aim: yaw, power: pw, disc, hyzer, mirror: forehand,
      launch: fp ? pitch + PUTT_LAUNCH_OFFSET : undefined,
      style: puttStyle() ? 'putt' : 'drive',
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

  function release(): void {
    if (phase !== 'charging') return;
    const result = simulateThrow(throwInput(Math.max(0.01, power)), world());
    flight = { result, t0: performance.now(), speed: puttStyle() ? 1 : PLAYBACK };
    phase = 'flying';
    scene.setPreview(null, '#fff');
    updateHud();
  }

  function finishThrow(): void {
    const r = flight!.result;
    const idx = game().current;
    scene.addTrail(r.samples, player().color);
    flight = null;
    game().applyShot(r);
    const done = game().players[idx];
    let msg = r.events.map((e) => EVENT_TOASTS[e]).filter((m, i, a) => m && a.indexOf(m) === i).join(' · ');
    if (done.holed) msg = `${r.events.includes('chains') ? 'Chains! ' : ''}${esc(done.name)}: ${scoreWord(done.strokes, hole().par)}`;
    else if (done.pickedUp) msg = `${esc(done.name)} picks up (${done.strokes})`;
    if (msg) toast(msg);
    phase = 'between';
    updateHud();
    if (game().finished) {
      round.recordCurrent();
      updateHud();
      setTimeout(showCard, 1500);
    } else {
      setTimeout(startTurn, msg ? 1300 : 600);
    }
  }

  function scoreWord(strokes: number, par: number): string {
    if (strokes === 1) return 'ACE!';
    const n: Record<number, string> = { [-3]: 'Albatross', [-2]: 'Eagle', [-1]: 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
    return n[strokes - par] ?? `+${strokes - par}`;
  }

  // ---------- scorecard ----------
  function showCard(): void {
    const last = round.isLastHole;
    const idx = [...Array(round.count).keys()].map((k) => round.first + k);
    const head = `<tr><th></th>${idx.map((i) => `<th>${course.holes[i].ref}</th>`).join('')}<th>Tot</th><th>±</th></tr>`;
    const par = `<tr class="par"><td>Par</td>${idx.map((i) => `<td>${course.holes[i].par}</td>`).join('')}<td>${idx.reduce((s, i) => s + course.holes[i].par, 0)}</td><td></td></tr>`;
    const rows = opts.names.map((n, p) => `<tr><td><span style="color:${PLAYER_COLORS[p]}">●</span> ${esc(n)}</td>${idx.map((i) => {
      const v = round.scores[p][i];
      const cls = v === undefined ? '' : v < course.holes[i].par ? 'under' : v > course.holes[i].par ? 'over' : '';
      return `<td class="${cls}">${v ?? ''}</td>`;
    }).join('')}<td>${round.total(p)}</td><td>${fmtPar(round.toPar(p))}</td></tr>`);
    $('results-title').textContent = last ? 'Round complete' : `Hole ${hole().ref} complete`;
    $('results-table').innerHTML = head + par + rows.join('');
    $('next').hidden = last;
    $('again').hidden = !last;
    $('results').hidden = false;
    $('hud').hidden = true;
    $('toast').hidden = true;
  }

  $('next').addEventListener('click', () => {
    $('results').hidden = true;
    $('hud').hidden = false;
    if (round.nextHole()) startHole();
  });
  $('again').addEventListener('click', () => location.reload());

  // ---------- HUD ----------
  let toastTimer = 0;
  function toast(msg: string): void {
    const el = $('toast');
    el.innerHTML = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { el.hidden = true; }, 2200);
  }

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
    $('stats').innerHTML = `Basket <b>${Math.round(toBasket())} m</b> · Target <b>${Math.round(dist(p.ball, aimTarget))} m</b> · Lie <b>${LIE_LABELS[p.lie] ?? p.lie}</b> · Throw <b>${p.strokes + 1}</b>`;
    $('meter-fill').style.width = `${power * 100}%`;
    $('meter-target').style.left = `${tick * 100}%`;
    $('view-toggle').textContent = VIEW_LABELS[scene.viewMode];
    $('fp-toggle').textContent = isFP() ? '1st person' : 'Top-down';
    $('swing').toggleAttribute('disabled', phase !== 'aim' && phase !== 'charging');
    $('swing').innerHTML = `Hold to ${puttStyle() ? 'putt' : 'throw'} <kbd>Space</kbd>`;
    $('help').textContent = isFP()
      ? 'Drag or arrows to aim (up/down = launch) · Q/E release angle · [ / ] disc · T forehand · C top-down · V view'
      : 'Click to aim · ←/→ fine aim · Q/E release angle · [ / ] disc · T forehand · C 1st person · right-drag pan · scroll zoom · V view · F re-frame';
    $('scoreboard').innerHTML = game().players.map((q, i) => {
      const toPar = round.toPar(i);
      const state = q.holed ? `${scoreWord(q.strokes, hole().par)}` : q.pickedUp ? 'picked up' : `${Math.round(dist(q.ball, hole().pin))} m · ${LIE_LABELS[q.lie] ?? q.lie}`;
      return `<div class="row ${i === game().current && !game().finished ? 'active' : ''}"><span class="dot" style="background:${q.color}"></span><span class="name">${esc(q.name)}</span><span class="strokes">${q.strokes}</span><span class="topar">${fmtPar(toPar)}</span></div><div class="state">${state}</div>`;
    }).join('');
  }

  // ---------- input ----------
  const canvas = scene.renderer.domElement;
  let drag: { x: number; y: number; mode: 'aim' | 'pan' | 'look' } | null = null;

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
    if (isFP()) drag = { x: e.clientX, y: e.clientY, mode: 'look' };
    else if (e.button === 0 && phase === 'aim') { drag = { x: e.clientX, y: e.clientY, mode: 'aim' }; setAimTarget(scene.screenToWorld(e.clientX, e.clientY)); }
    else drag = { x: e.clientX, y: e.clientY, mode: 'pan' };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'aim' && phase === 'aim') setAimTarget(scene.screenToWorld(e.clientX, e.clientY));
    else if (drag.mode === 'pan') scene.panPixels(e.clientX - drag.x, e.clientY - drag.y);
    else if (drag.mode === 'look' && (phase === 'aim' || phase === 'charging')) {
      look((-(e.clientX - drag.x) * 0.0025), (-(e.clientY - drag.y) * 0.0025));
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!isFP()) scene.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
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
    fpOverride = !isFP();
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
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startCharge(); return; }
    const k = e.key.toLowerCase();
    if (k === '[') cycleDisc(-1);
    else if (k === ']') cycleDisc(1);
    else if (k === 'arrowleft') rotateAim(e.shiftKey ? 0.2 : 1);
    else if (k === 'arrowright') rotateAim(e.shiftKey ? -0.2 : -1);
    else if (k === 'arrowup' && isFP() && phase === 'aim') { look(0, (e.shiftKey ? 0.2 : 1) * Math.PI / 180); recomputeTick(); }
    else if (k === 'arrowdown' && isFP() && phase === 'aim') { look(0, -(e.shiftKey ? 0.2 : 1) * Math.PI / 180); recomputeTick(); }
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

  // ---------- frame loop ----------
  function frameLoop(now: number): void {
    if (phase === 'charging') {
      const t = ((now - chargeStart) / 1000) % 2;
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
    if (flight) {
      const s = flight.result.samples;
      const k = Math.floor(((now - flight.t0) / 1000) * 60 * flight.speed);
      const kk = Math.min(k, s.length - 1);
      scene.setDisc(g.current, s[kk], flight.result.banks[kk] ?? 0, heading(s, kk), true);
      scene.setAim(null, [0, 0], '#fff');
      if (k >= s.length + 25) finishThrow();
    } else if (phase === 'aim' || phase === 'charging') {
      const p = player();
      scene.setAim(isFP() ? null : p.ball, aimTarget, p.color);
      scene.setPreview(ghost(phase === 'charging' ? Math.max(power, 0.01) : tick).samples, p.color);
    } else {
      scene.setAim(null, [0, 0], '#fff');
      scene.setPreview(null, '#fff');
    }
    scene.render();
    requestAnimationFrame(frameLoop);
  }

  $('hud').hidden = false;
  startHole();
  requestAnimationFrame(frameLoop);
}
