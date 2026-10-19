import { LocalFrame, dist, type Vec2 } from './course/geo';
import type { CourseFile } from './course/types';
import { CLUBS, PUTTER, PUTT_MAX_M, YD, suggestClub, type Club } from './game/clubs';
import { HoleGame, PLAYER_COLORS, scoreName } from './game/game';
import { lieMultiplier, previewCarry, SURFACES, simulateShot, type ShotEvent, type ShotResult, type World } from './game/physics';
import { SurfaceGrid } from './game/surfaces';
import { FlatTerrain, type Vec3 } from './game/terrain';
import { HoleScene, VIEW_LABELS, type ViewMode } from './render/scene';
import { ESRI_ATTRIBUTION, loadImagery } from './render/tiles';

const COURSE_URL = '/courses/tcc-main-17.json';
const VIEWS: ViewMode[] = ['photo', 'overlay', 'classes'];
/** Shot playback speed vs real time; real hang time feels slow when passing the device around. */
const PLAYBACK = 1.5;
const LIE_LABELS: Record<string, string> = {
  tee: 'Tee', fairway: 'Fairway', rough: 'Rough', trees: 'Trees', bunker: 'Bunker', green: 'Green', path: 'Cart path', water: 'Water', oob: 'OB',
};
const EVENT_TOASTS: Partial<Record<ShotEvent, string>> = {
  tree: 'Into the trees!', water: 'Splash! +1, drop', oob: 'Out of bounds. +1, drop', bunker: 'In the bunker', lipout: 'Lipped out!',
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const yd = (m: number) => Math.round(m / YD);

type Phase = 'setup' | 'aim' | 'charging' | 'flying' | 'done';

const course: CourseFile = await (await fetch(COURSE_URL)).json();
const hole = course.holes[0];
const frame = new LocalFrame(course.origin);
const grid = SurfaceGrid.fromHole(hole);
const world: World = { grid, terrain: new FlatTerrain(), pin: hole.pin };

$('hole-info').innerHTML = `<b>${course.name}</b><br>Hole ${hole.ref}${course.links ? ` (${course.links})` : ''} · Par ${hole.par} · ${yd(hole.length_m)} yd`;
$('setup-hole').textContent = `${course.name}, hole ${hole.ref}: par ${hole.par}, ${yd(hole.length_m)} yd`;
$('attribution').textContent = `${ESRI_ATTRIBUTION} · Course data ${course.source.attribution}`;

const scene = new HoleScene($('stage'), hole, grid, PLAYER_COLORS);
scene.frame([hole.tee, hole.pin, ...hole.routing]);

$('status').textContent = 'Loading imagery…';
loadImagery(frame, hole.bounds)
  .then((img) => {
    scene.setImagery(img, course.imagery_offset_m);
    $('status').textContent = img.failedTiles ? `${img.failedTiles} imagery tiles failed to load` : '';
  })
  .catch((e) => { $('status').textContent = `Imagery unavailable (${e.message}); showing classes`; });

// ---------- setup ----------
const savedNames = (() => {
  try { return JSON.parse(localStorage.getItem('sat-golf:names') ?? '[]') as string[]; } catch { return []; }
})();

function renderNameInputs(): void {
  const n = parseInt($<HTMLSelectElement>('player-count').value, 10);
  const box = $('player-names');
  const current = [...box.querySelectorAll('input')].map((i) => i.value);
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const input = document.createElement('input');
    input.value = current[i] ?? savedNames[i] ?? `Player ${i + 1}`;
    input.style.borderLeft = `6px solid ${PLAYER_COLORS[i]}`;
    box.appendChild(input);
  }
}
$('player-count').addEventListener('change', renderNameInputs);
renderNameInputs();

// ---------- game state ----------
let game: HoleGame;
let phase: Phase = 'setup';
let aimTarget: Vec2 = hole.pin;
let club: Club = CLUBS[0];
let power = 0;
let chargeStart = 0;
let flight: { result: ShotResult; t0: number } | null = null;

$('start').addEventListener('click', () => {
  const names = [...$('player-names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`);
  try { localStorage.setItem('sat-golf:names', JSON.stringify(names)); } catch { /* storage unavailable */ }
  newGame(names);
});
$('again').addEventListener('click', () => newGame(game.players.map((p) => p.name)));

function newGame(names: string[]): void {
  game = new HoleGame(hole, names);
  scene.clearTrails();
  $('setup').hidden = true;
  $('results').hidden = true;
  $('hud').hidden = false;
  startTurn();
}

function allowedClubs(): Club[] {
  return game.player.lie === 'green' ? [PUTTER] : CLUBS;
}

/** Default aim: the next routing point ahead of the ball (dogleg corner), else the pin. */
function defaultTarget(from: Vec2): Vec2 {
  const dPin = dist(from, hole.pin);
  for (const p of hole.routing.slice(1, -1)) {
    if (dist(p, hole.pin) < dPin - 30 && dist(from, p) > 60) return p;
  }
  return hole.pin;
}

function startTurn(): void {
  phase = 'aim';
  power = 0;
  const p = game.player;
  aimTarget = defaultTarget(p.ball);
  const d = dist(p.ball, aimTarget);
  club = p.lie === 'green' ? PUTTER : suggestClub(d / lieMultiplier(p.lie, CLUBS[0]), p.lie === 'tee');
  const dPin = game.distanceToPin();
  if (dPin < 40) scene.frame([p.ball, hole.pin], 140, 30);
  else scene.frame([p.ball, hole.pin, ...hole.routing.filter((r) => dist(r, hole.pin) < dPin + 1)], 80);
  updateHud();
}

function aimAngle(): number {
  const b = game.player.ball;
  return Math.atan2(aimTarget[1] - b[1], aimTarget[0] - b[0]);
}

/** Power needed to reach the aim target, for the meter tick. */
function targetPower(): number {
  const p = game.player;
  const d = dist(p.ball, aimTarget);
  // Putts: aim ~0.3 m past the cup, since a ball that stops on the lip doesn't drop.
  if (club.carry === 0) return Math.min(1, (d + 0.3) / PUTT_MAX_M);
  const roll = 1 + club.roll * SURFACES.fairway.roll;
  return Math.min(1, d / (club.carry * lieMultiplier(p.lie, club) * roll));
}

function swing(): void {
  if (phase !== 'charging') return;
  const p = game.player;
  const result = simulateShot({ start: p.ball, aim: aimAngle(), club, power: Math.max(0.02, power) }, world);
  flight = { result, t0: performance.now() };
  phase = 'flying';
  updateHud();
}

function finishShot(): void {
  const r = flight!.result;
  const p = game.player;
  const idx = game.current;
  scene.addTrail(r.samples, p.color);
  flight = null;
  game.applyShot(r);
  const done = game.players[idx];
  let msg = r.events.map((e) => EVENT_TOASTS[e]).filter(Boolean).join(' · ');
  if (done.holed) msg = `${done.name}: ${scoreName(done.strokes, hole.par)} (${done.strokes})`;
  else if (done.pickedUp) msg = `${done.name} picks up (max ${done.strokes})`;
  if (msg) toast(msg);
  if (game.finished) {
    phase = 'done';
    updateHud();
    setTimeout(showResults, 1600);
  } else {
    phase = 'done';
    updateHud();
    setTimeout(startTurn, msg ? 1300 : 600);
  }
}

function showResults(): void {
  const rows = [...game.players]
    .sort((a, b) => a.strokes - b.strokes)
    .map((p) => `<tr><td><span style="color:${p.color}">●</span> ${esc(p.name)}</td><td>${p.strokes}</td><td>${p.holed ? scoreName(p.strokes, hole.par) : 'Picked up'}</td></tr>`);
  $('results-table').innerHTML = rows.join('');
  $('toast').hidden = true;
  $('results').hidden = false;
  $('hud').hidden = true;
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 2200);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- HUD ----------
function updateHud(): void {
  if (!game) return;
  const p = game.player;
  $('turn').innerHTML = `<span style="color:${p.color}">●</span> ${esc(p.name)}`;
  const carryTxt = club.carry ? `${yd(club.carry)} yd` : `${yd(PUTT_MAX_M)} yd max`;
  $('club-name').textContent = `${club.name} · ${carryTxt}`;
  $('stats').innerHTML = `To pin <b>${yd(game.distanceToPin())} yd</b> · Target <b>${yd(dist(p.ball, aimTarget))} yd</b> · Lie <b>${LIE_LABELS[p.lie]}</b> · Stroke <b>${p.strokes + 1}</b>`;
  $('meter-fill').style.width = `${power * 100}%`;
  $('meter-target').style.left = `${targetPower() * 100}%`;
  $('view-toggle').textContent = VIEW_LABELS[scene.viewMode];
  $('swing').toggleAttribute('disabled', phase !== 'aim' && phase !== 'charging');

  $('scoreboard').innerHTML = game.players
    .map((q, i) => {
      const state = q.holed ? scoreName(q.strokes, hole.par) : q.pickedUp ? 'picked up' : `${yd(game.distanceToPin(q))} yd · ${LIE_LABELS[q.lie]}`;
      return `<div class="row ${i === game.current && !game.finished ? 'active' : ''}"><span class="dot" style="background:${q.color}"></span><span class="name">${esc(q.name)}</span><span class="strokes">${q.strokes}</span></div><div class="state">${state}</div>`;
    })
    .join('');
}

// ---------- input ----------
const canvas = scene.renderer.domElement;
let panning: { x: number; y: number } | null = null;
let aiming = false;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 0 && phase === 'aim') {
    aiming = true;
    aimTarget = scene.screenToWorld(e.clientX, e.clientY);
    updateHud();
  } else {
    panning = { x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (aiming && phase === 'aim') {
    aimTarget = scene.screenToWorld(e.clientX, e.clientY);
    updateHud();
  } else if (panning) {
    scene.panPixels(e.clientX - panning.x, e.clientY - panning.y);
    panning = { x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointerup', () => { aiming = false; panning = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

function startCharge(): void {
  if (phase !== 'aim') return;
  phase = 'charging';
  chargeStart = performance.now();
}

function cycleClub(dir: 1 | -1): void {
  if (phase !== 'aim') return;
  const list = allowedClubs();
  const i = list.indexOf(club);
  club = list[(i + dir + list.length) % list.length];
  updateHud();
}

function rotateAim(deg: number): void {
  if (phase !== 'aim') return;
  const b = game.player.ball;
  const a = aimAngle() + (deg * Math.PI) / 180;
  const d = dist(b, aimTarget);
  aimTarget = [b[0] + Math.cos(a) * d, b[1] + Math.sin(a) * d];
  updateHud();
}

function cycleView(): void {
  scene.setView(VIEWS[(VIEWS.indexOf(scene.viewMode) + 1) % VIEWS.length]);
  updateHud();
}

window.addEventListener('keydown', (e) => {
  if (phase === 'setup' || (e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startCharge(); }
  else if (e.key === '[' || e.key === 'ArrowDown') cycleClub(-1);
  else if (e.key === ']' || e.key === 'ArrowUp') cycleClub(1);
  else if (e.key === 'ArrowLeft') rotateAim(e.shiftKey ? 0.2 : 1);
  else if (e.key === 'ArrowRight') rotateAim(e.shiftKey ? -0.2 : -1);
  else if (e.key === 'v' || e.key === 'V') cycleView();
  else if (e.key === 'f' || e.key === 'F') startTurnFrame();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') swing(); });

const swingBtn = $('swing');
swingBtn.addEventListener('pointerdown', (e) => { swingBtn.setPointerCapture(e.pointerId); startCharge(); });
swingBtn.addEventListener('pointerup', swing);
$('club-prev').addEventListener('click', () => cycleClub(-1));
$('club-next').addEventListener('click', () => cycleClub(1));
$('view-toggle').addEventListener('click', cycleView);

function startTurnFrame(): void {
  if (!game) return scene.frame([hole.tee, hole.pin, ...hole.routing]);
  const p = game.player;
  scene.frame([p.ball, hole.pin, aimTarget], 80);
}

// ---------- frame loop ----------
function tick(now: number): void {
  if (phase === 'charging') {
    // Triangle wave 0 → 1 → 0 over 2 s.
    const t = ((now - chargeStart) / 1000) % 2;
    power = t < 1 ? t : 2 - t;
    $('meter-fill').style.width = `${power * 100}%`;
  }

  if (game) {
    PLAYER_COLORS.forEach((_, i) => {
      const q = game.players[i];
      scene.setBall(i, q && !q.holed ? [q.ball[0], q.ball[1], 0] : null, i === game.current);
    });
    const p = game.player;
    if (flight) {
      const k = Math.floor(((now - flight.t0) / 1000) * 60 * PLAYBACK);
      const s = flight.result.samples;
      const pos: Vec3 = s[Math.min(k, s.length - 1)];
      scene.setBall(game.current, pos, true);
      scene.setAim(null, [0, 0], 0, '#fff');
      if (k >= s.length + 20) finishShot();
    } else if (phase === 'aim' || phase === 'charging') {
      const pw = phase === 'charging' ? Math.max(power, 0.02) : 1;
      const carry = previewCarry({ start: p.ball, aim: 0, club, power: pw }, p.lie);
      const a = aimAngle();
      const land: Vec2 = [p.ball[0] + Math.cos(a) * carry, p.ball[1] + Math.sin(a) * carry];
      const spread = carry * Math.tan(((club.dispersionDeg * SURFACES[p.lie].dispersion) * Math.PI) / 180);
      scene.setAim(p.ball, land, spread, p.color);
    } else {
      scene.setAim(null, [0, 0], 0, '#fff');
    }
  }
  scene.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
