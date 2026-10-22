// Main menu: course, players, round (holes / Crazy mode) and settings, then hand off to the disc
// golf mode. "Play again" / "Quit to main menu" reload, which brings the menu back with the last
// choices filled in. (Golf still lives in src/modes/golf.ts but isn't on the menu: disc only for now.)
import { PLAYER_COLORS } from './game/game';
import { mountSettings } from './ui/settingsForm';
import { IMAGERY, asset } from './assets';
import { fmtLen } from './units';
import { MAX_PLAYERS, ROOMS_URL, RoomClient, newRoomCode, uniqueNames, type Lobby, type Member } from './net/room';
import type { RoundEvent } from './modes/discRound';
import { cleanRules, RULE_LIMITS, tierWeights, type CrazyRules } from './rogue/rules';
import { closeAugmentBrowser, openAugmentBrowser } from './ui/augments';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const load = <T>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; }
};
const save = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
};

type CourseId = 'simple' | 'silly' | 'forest' | 'fantasy' | 'rainbow';
/** Real: actual courses from map data. Arcade: hand-built themed courses. */
type Group = 'real' | 'arcade';
const GROUPS: { id: Group; label: string; sub: string }[] = [
  { id: 'real', label: 'Real', sub: 'Mapped from the real world' },
  { id: 'arcade', label: 'Arcade', sub: 'Themed and a little ridiculous' },
];
const COURSES: { id: CourseId; group: Group; name: string; meta: string; holes: number; blurb: string; art: string }[] = [
  {
    id: 'simple', group: 'real', name: 'Tali Recreation', meta: 'Helsinki, Finland · the easy version', holes: 18,
    blurb: 'The real Tali disc golf park layout and its real trees, drawn clean, with the woods cut back a few meters from every fairway, green and tee. Tali Forest is the real thing.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#3c4a37"/><path d="M8 58 C 20 40, 30 30, 50 8" stroke="#8cc063" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="20" cy="26" r="7" fill="#2f6a2f"/><circle cx="44" cy="40" r="6" fill="#2f6a2f"/><circle cx="50" cy="9" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'silly', group: 'arcade', name: 'Mini Golf Madness', meta: 'Windmills, castles, giant animals', holes: 9,
    blurb: 'A full-size course themed like mini golf: thread the giant windmill’s tunnel past spinning blades, fly a castle gate, dodge cows, penguins and giant golf balls.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#4f8f45"/><rect x="0" y="40" width="64" height="24" fill="#2fb24c"/><path d="M26 44 L29 22 L35 22 L38 44 Z" fill="#c9a27a"/><g transform="translate(32 24)" stroke="#8a4b2e" stroke-width="4" stroke-linecap="round"><path d="M-12 -12 L12 12 M12 -12 L-12 12"/></g><circle cx="32" cy="24" r="2.5" fill="#999"/><circle cx="50" cy="50" r="5" fill="#e2504f"/></svg>`,
  },
  {
    id: 'forest', group: 'real', name: 'Tali Forest', meta: `${IMAGERY ? 'Satellite imagery · ' : ''}10k real-canopy trees`, holes: 18,
    blurb: `The same Tali holes${IMAGERY ? ' over live satellite imagery' : ''}, with ~10,000 trees placed from Helsinki’s 2024 canopy data. Tight and woody.`,
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#24391f"/>${Array.from({ length: 18 }, (_, i) => `<circle cx="${(i * 37) % 64}" cy="${(i * 23) % 64}" r="${5 + (i % 3)}" fill="${i % 2 ? '#2f5a2a' : '#3b6e33'}"/>`).join('')}<path d="M10 60 L54 6" stroke="#8a9a6a" stroke-width="5" stroke-dasharray="1 0" opacity=".7"/></svg>`,
  },
  {
    id: 'fantasy', group: 'arcade', name: 'Fantasy Fairways', meta: 'Knights, a castle keep, one dragon', holes: 9,
    blurb: 'A medieval course: dodge a giant knight on The Joust, fly the gate into a castle courtyard, cross the moat, and finish under a dragon on Dragon’s Lair.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#46603a"/><rect x="0" y="44" width="64" height="20" fill="#7da35a"/><path d="M14 46 V24 h6 v-4 h4 v4 h4 v-4 h4 v4 h4 v-4 h4 v4 h6 v22 h-12 v-10 a4 4 0 0 0 -8 0 v10 z" fill="#d8a77c"/><path d="M14 24 L17 14 L20 24 M44 24 L47 14 L50 24" fill="#5b6fd6"/><path d="M40 10 c6 -2 12 2 14 6 c-4 -1 -6 0 -8 2 c-2 -3 -4 -5 -6 -8z" fill="#2b2b33"/></svg>`,
  },
  {
    id: 'rainbow', group: 'arcade', name: 'Rainbow Runs', meta: 'A rainbow road in deep space · no guardrails', holes: 9,
    blurb: 'Nine laps of a rainbow road floating in space. Stay on the track (off it is lost in space, +1), dodge mystery boxes and asteroids, thread the rings, and jump the gap.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#0b0b26"/>${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 41) % 64}" cy="${(i * 17) % 64}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff"/>`).join('')}${['#ff4d6d', '#ff9f43', '#ffe066', '#5ee07a', '#4dabf7', '#9b6bff'].map((c, i) => `<path d="M${-4 + i * 3} 64 C 14 30, 40 50, ${52 + i * 3} 0" stroke="${c}" stroke-width="3.2" fill="none"/>`).join('')}<rect x="40" y="24" width="10" height="10" rx="2" fill="#ffb347" transform="rotate(15 45 29)"/><text x="45" y="32.5" font-size="9" font-weight="700" fill="#fff" text-anchor="middle" transform="rotate(15 45 29)">?</text></svg>`,
  },
];

const last = load<{ course?: CourseId; holes?: string; players?: number; crazy?: boolean }>('sat-golf:menu', {});
let course: CourseId = COURSES.some((c) => c.id === last.course) ? last.course! : 'simple';
let players = Math.min(MAX_PLAYERS, Math.max(1, last.players ?? 2));
const savedNames = load<string[]>('sat-golf:names', []);

// ---------- course cards ----------
function renderCourses(): void {
  $('course-cards').innerHTML = GROUPS.map((g) => `
    <div class="course-group"><span class="group-label">${g.label}</span><span class="group-sub">${g.sub}</span></div>
    ${COURSES.filter((c) => c.group === g.id).map((c) => `
    <button class="course-card ${c.id === course ? 'on' : ''}" data-id="${c.id}">
      <span class="art">${c.art}</span>
      <span><div class="name">${c.name}</div><div class="meta">${c.meta}</div></span>
      <span class="holes">${c.holes}<small>HOLES</small></span>
    </button>`).join('')}`).join('');
  $('course-cards').querySelectorAll<HTMLButtonElement>('.course-card').forEach((b) => b.addEventListener('click', () => {
    course = b.dataset.id as CourseId;
    renderCourses();
    renderHoles();
    pushLobby();
  }));
  $('setup-hole').textContent = COURSES.find((c) => c.id === course)!.blurb;
  renderCourseInfo();
}

// ---------- course info card: name, description, par and stats for the holes being played ----------
let summary: Record<string, { pars: number[]; lengths: number[] }> | null = null;
fetch(asset('courses/summary.json')).then((r) => r.json()).then((s) => { summary = s; renderCourseInfo(); }).catch(() => { /* stats are optional */ });

function renderCourseInfo(): void {
  const c = COURSES.find((x) => x.id === course)!;
  $('ci-name').textContent = c.name;
  $('ci-meta').textContent = c.meta;
  const s = summary?.[course];
  if (!s) { $('ci-stats').innerHTML = ''; return; }
  const [first, count] = holesFromMenu();
  const idx = Array.from({ length: count }, (_, k) => first + k).filter((i) => i < s.pars.length);
  const par = idx.reduce((a, i) => a + s.pars[i], 0);
  const len = idx.reduce((a, i) => a + s.lengths[i], 0);
  const stat = (v: string, label: string, note = '') => `<div class="ci-stat"><b>${v}</b><small>${label}</small>${note ? `<em>${note}</em>` : ''}</div>`;
  const which = count === s.pars.length ? `${count} holes` : count === 1 ? `Hole ${first + 1}` : `Holes ${first + 1}–${first + count}`;
  const stats = [stat(String(par), 'Par', which), stat(fmtLen(len), count === 1 ? 'Length' : 'Total length')];
  if (count > 1) {
    const longest = idx.reduce((a, i) => (s.lengths[i] > s.lengths[a] ? i : a), idx[0]);
    stats.push(stat(fmtLen(s.lengths[longest]), 'Longest hole', `Hole ${longest + 1} · par ${s.pars[longest]}`));
  }
  $('ci-stats').innerHTML = stats.join('');
}
window.addEventListener('unitschange', renderCourseInfo);

// ---------- holes ----------
function renderHoles(): void {
  const n = COURSES.find((c) => c.id === course)!.holes;
  const opts = [
    { v: `0:${n}`, label: `Full round (${n})` },
    ...(n >= 18 ? [{ v: '0:9', label: 'Front 9' }, { v: '9:9', label: 'Back 9' }] : []),
    ...Array.from({ length: n }, (_, i) => ({ v: `${i}:1`, label: `Hole ${i + 1} only` })),
  ];
  const sel = $<HTMLSelectElement>('holes');
  const prev = sel.value || last.holes;
  sel.innerHTML = opts.map((o) => `<option value="${o.v}">${o.label}</option>`).join('');
  if (prev && opts.some((o) => o.v === prev)) sel.value = prev;
  renderCourseInfo();
}

// ---------- players ----------
function renderPlayers(): void {
  $('player-seg').innerHTML = Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1)
    .map((k) => `<button data-n="${k}" class="${k === players ? 'on' : ''}" title="${k} ${k === 1 ? 'player' : 'players'}">${k === 1 ? '1 player' : k}</button>`).join('');
  $('player-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    players = parseInt(b.dataset.n!, 10);
    renderPlayers();
  }));
  const box = $('player-names');
  const current = [...box.querySelectorAll('input')].map((i) => i.value);
  box.innerHTML = '';
  for (let i = 0; i < players; i++) {
    const row = document.createElement('div');
    row.className = 'pname';
    row.innerHTML = `<i style="background:${PLAYER_COLORS[i]}"></i><input value="" maxlength="16" />`;
    row.querySelector('input')!.value = current[i] ?? savedNames[i] ?? `Player ${i + 1}`;
    box.appendChild(row);
  }
  $<HTMLSelectElement>('player-count').value = String(players);
}

// ---------- crazy mode ----------
const crazy = $<HTMLInputElement>('crazy');
crazy.checked = !!last.crazy;
const syncCrazy = () => { $('crazy-rules').hidden = !crazy.checked; };

// ---------- Crazy mode rules ----------
let rules: CrazyRules = cleanRules(load<Partial<CrazyRules> | null>('sat-golf:crazy-rules', null));
const ODDS_PRESETS: [string, CrazyRules['odds']][] = [
  ['Classic', { common: 70, epic: 25, legendary: 5 }],
  ['Spicy', { common: 40, epic: 40, legendary: 20 }],
  ['Wild', { common: 10, epic: 40, legendary: 50 }],
  ['All legendary', { common: 0, epic: 0, legendary: 1 }],
];
function setRules(r: Partial<CrazyRules>): void {
  rules = cleanRules({ ...rules, ...r, odds: { ...rules.odds, ...r.odds } });
  save('sat-golf:crazy-rules', rules);
  renderRules();
}
function renderRules(): void {
  const seg = (id: string, opts: [number, string][], cur: number, set: (v: number) => void) => {
    $(id).innerHTML = opts.map(([v, label]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${label}</button>`).join('');
    $(id).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => set(parseInt(b.dataset.v!, 10))));
  };
  const range = ([lo, hi]: readonly [number, number]) => Array.from({ length: hi - lo + 1 }, (_, i): [number, string] => [lo + i, String(lo + i)]);
  seg('rule-cards', range(RULE_LIMITS.cards), rules.cards, (v) => setRules({ cards: v }));
  seg('rule-picks', range(RULE_LIMITS.picks), rules.picks, (v) => setRules({ picks: v }));
  seg('rule-every', [[1, 'Every hole'], [2, 'Every 2nd'], [3, 'Every 3rd']], rules.every, (v) => setRules({ every: v }));
  $<HTMLInputElement>('rule-starter').checked = rules.starter;
  for (const t of ['common', 'epic', 'legendary'] as const) {
    const el = $<HTMLInputElement>(`odd-${t}`);
    if (document.activeElement !== el) el.value = String(rules.odds[t]);
  }
  const w = tierWeights(rules, false);
  $('odds-bar').innerHTML = (['common', 'epic', 'legendary'] as const).filter((t) => w[t] > 0)
    .map((t) => `<span class="${t}" style="flex:${w[t]}" title="${t}: ${Math.round(w[t] * 100)}%">${w[t] >= 0.08 ? `${Math.round(w[t] * 100)}%` : ''}</span>`).join('');
  $('odds-presets').innerHTML = ODDS_PRESETS.map(([n, o], i) => `<button data-i="${i}" class="${JSON.stringify(o) === JSON.stringify(rules.odds) ? 'on' : ''}">${n}</button>`).join('');
  $('odds-presets').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => setRules({ odds: ODDS_PRESETS[parseInt(b.dataset.i!, 10)][1] })));
}
$('rule-starter').addEventListener('change', () => setRules({ starter: $<HTMLInputElement>('rule-starter').checked, starterBoost: $<HTMLInputElement>('rule-starter').checked }));
for (const t of ['common', 'epic', 'legendary'] as const) {
  $(`odd-${t}`).addEventListener('change', () => setRules({ odds: { ...rules.odds, [t]: Math.max(0, parseFloat($<HTMLInputElement>(`odd-${t}`).value) || 0) } }));
}
$('browse-augments').addEventListener('click', () => openAugmentBrowser());
$('aug-close').addEventListener('click', closeAugmentBrowser);
$('aug-browser').addEventListener('click', (e) => { if (e.target === $('aug-browser')) closeAugmentBrowser(); });
renderRules();
crazy.addEventListener('change', () => { syncCrazy(); pushLobby(); renderCourseInfo(); });
$('holes').addEventListener('change', () => { pushLobby(); renderCourseInfo(); });

renderCourses();
renderHoles();
renderPlayers();
syncCrazy();
mountSettings($('settings-menu-form'));
mountSettings($('settings-game'));

// ---------- pause menu (Esc / ⏸) ----------
const openPause = (open: boolean) => { $('settings').hidden = !open; };
$('settings-btn').addEventListener('click', () => openPause(true));
$('settings-close').addEventListener('click', () => openPause(false));
$('settings-menu').addEventListener('click', () => { leaveRoomLink(); location.reload(); });
$('pause-card').addEventListener('click', () => { openPause(false); window.dispatchEvent(new Event('show-scorecard')); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('aug-browser').hidden === false) { closeAugmentBrowser(); return; }
  if (e.key === 'Escape' && $('name-ask').hidden === false) { $('name-cancel').click(); return; }
  if (e.key === 'Escape' && $('setup').hidden === true) openPause($('settings').hidden === true);
});

// ---------- online rooms ----------
// Host a room or join one by code (or link, #room=CODE). The host's course, holes and Crazy mode
// setting are the room's; everyone connected gets a player (up to MAX_PLAYERS; more can watch).
// Hosting or joining asks for your name first; it can be changed in the lobby until the start.
let room: RoomClient | null = null;
let me = '';
let host = '';
let members: Member[] = [];
let lobby: Lobby | null = null;
let launched = false;
/** The room's events so far. Handed to the game, which keeps appending until it takes over. */
const roomLog: { seq: number; from: string; e: RoundEvent }[] = [];
const amHost = () => !!room && me === host;
const myName = () => $('player-names').querySelector('input')?.value.trim() || savedNames[0] || 'Player';
const roomLink = (code: string) => `${location.origin}${location.pathname}#room=${code}`;
function leaveRoomLink(): void {
  if (location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search);
}

function holesFromMenu(): [number, number] {
  const n = COURSES.find((c) => c.id === course)!.holes;
  const [first, count] = $<HTMLSelectElement>('holes').value.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(first) || !Number.isFinite(count)) return [0, n]; // holes list not filled yet
  return [first, Math.min(count, n - first)];
}

/** Host: the menu's setup and everyone connected (host first) become the room's lobby. */
function pushLobby(): void {
  if (!room || !amHost() || launched) return;
  const [first, count] = holesFromMenu();
  // Host first, then whoever already had a seat (in seat order), then newcomers: someone joining
  // later never bumps an earlier player to watching.
  const seatOf = (m: Member) => {
    if (m.client === host) return -1;
    const k = lobby?.seats.findIndex((q) => q.client === m.client) ?? -1;
    return k >= 0 ? k : MAX_PLAYERS;
  };
  const order = [...members].sort((a, b) => seatOf(a) - seatOf(b)); // stable: newcomers keep arrival order
  const seated = order.slice(0, MAX_PLAYERS);
  const names = uniqueNames(seated.map((m) => m.name), seated.map((m) => m.client));
  room.setLobby({ course, first, count, crazy: crazy.checked, seats: seated.map((m, i) => ({ name: names[i], client: m.client })) });
}

/** Guests: show the host's setup. */
function showLobby(l: Lobby): void {
  if (COURSES.some((c) => c.id === l.course)) course = l.course as CourseId;
  crazy.checked = l.crazy;
  renderCourses();
  renderHoles();
  const sel = $<HTMLSelectElement>('holes');
  if ([...sel.options].some((o) => o.value === `${l.first}:${l.count}`)) sel.value = `${l.first}:${l.count}`;
  syncCrazy();
}

function renderRoom(): void {
  const inRoom = !!room;
  $('online-start').hidden = inRoom;
  $('online-room').hidden = !inRoom;
  $('player-seg').hidden = inRoom;
  $('setup').classList.toggle('online-guest', inRoom && !amHost());
  const rows = [...$('player-names').children] as HTMLElement[];
  rows.forEach((r, i) => { r.hidden = inRoom && i > 0; });
  const nameInput = $('player-names').querySelector('input');
  if (nameInput) nameInput.title = inRoom ? 'Your name in the room (Enter to change it)' : '';
  const start = $<HTMLButtonElement>('start');
  if (!room) { start.disabled = false; start.innerHTML = 'Tee off <span class="arrow">→</span>'; return; }
  $('room-code').textContent = room.code;
  const seats = lobby?.seats ?? members.map((m) => ({ name: m.name, client: m.client }));
  const watching = members.filter((m) => !seats.some((q) => q.client === m.client));
  $('room-members').innerHTML = [
    ...seats.map((q, i) => `<div class="m"><i style="background:${PLAYER_COLORS[i]}"></i><span>${escapeHtml(q.name)}</span><small>${q.client === me ? 'you' : ''}${q.client === host ? `${q.client === me ? ' · ' : ''}host` : ''}${members.some((m) => m.client === q.client) ? '' : ' · away'}</small></div>`),
    ...watching.map((m) => `<div class="m"><i style="background:#555"></i><span>${escapeHtml(m.name)}</span><small>watching</small></div>`),
  ].join('');
  $('room-note').textContent = amHost()
    ? 'Send friends the link (or the code). Pick the course and round here; everyone in the room plays.'
    : 'The host picks the course and starts the game.';
  start.disabled = !amHost();
  start.innerHTML = amHost() ? 'Start online game <span class="arrow">→</span>' : 'Waiting for the host…';
}
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Ask for a name (prefilled with the last one). Null: cancelled. */
function askName(title: string, ok: string): Promise<string | null> {
  const modal = $('name-ask'), input = $<HTMLInputElement>('name-input');
  $('name-title').textContent = title;
  $('name-ok').textContent = ok;
  input.value = myName();
  modal.hidden = false;
  input.focus();
  input.select();
  return new Promise((done) => {
    const finish = (v: string | null) => {
      modal.hidden = true;
      $('name-form').removeEventListener('submit', submit);
      $('name-cancel').removeEventListener('click', cancel);
      done(v);
    };
    const submit = (e: Event) => { e.preventDefault(); const v = input.value.trim(); if (v) finish(v.slice(0, 16)); else input.focus(); };
    const cancel = () => finish(null);
    $('name-form').addEventListener('submit', submit);
    $('name-cancel').addEventListener('click', cancel);
  });
}

/** Our name, from the name prompt or the lobby: shown in the first player row and remembered. */
function setMyName(name: string): void {
  const input = $('player-names').querySelector('input');
  if (input) input.value = name;
  savedNames[0] = name;
  save('sat-golf:names', savedNames);
}

/** Ask for a name, then join (or host: a new code). Cancelling joins nothing. */
async function enterRoom(code: string, hosting: boolean): Promise<void> {
  const name = await askName(hosting ? 'Host a room' : `Join room ${code}`, hosting ? 'Host' : 'Join');
  if (!name) { if (!room) leaveRoomLink(); return; }
  setMyName(name);
  joinRoom(code);
}

function joinRoom(code: string): void {
  room?.close();
  const r = new RoomClient(code, myName());
  room = r;
  history.replaceState(null, '', `#room=${code}`);
  r.on({
    welcome: (w) => {
      if (launched) return;
      me = w.you; host = w.host; members = w.members; lobby = w.lobby;
      roomLog.length = 0;
      roomLog.push(...w.log);
      if (lobby && !amHost()) showLobby(lobby);
      renderRoom();
      if (w.started && w.lobby) launch(w.lobby);
      else pushLobby();
    },
    members: (m) => { members = m; if (!launched) { pushLobby(); renderRoom(); } },
    lobby: (l) => { lobby = l; if (!launched) { if (!amHost()) showLobby(l); renderRoom(); } },
    started: (l) => { lobby = l; launch(l); },
    // Until the game takes over (it replaces this handler), keep the room's events for it.
    event: (seq, from, e) => { if (seq === roomLog.length) roomLog.push({ seq, from, e }); },
    status: (s) => { if (!launched) $('room-note').textContent = s === 'open' ? $('room-note').textContent : s === 'connecting' ? 'Connecting…' : 'Connection lost: reconnecting…'; },
    error: (reason) => { if (!launched) $('room-note').textContent = reason; },
  });
  r.connect();
  renderRoom();
}

$('online').hidden = !ROOMS_URL;
$('host-room').addEventListener('click', () => void enterRoom(newRoomCode(), true));
$('join-room').addEventListener('click', () => {
  const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length >= 4) void enterRoom(code, false);
});
// In the lobby, the first player row is our name: changing it renames us in the room.
$('player-names').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (!room || launched || input !== $('player-names').querySelector('input')) return;
  const name = input.value.trim().slice(0, 16);
  if (!name) { input.value = members.find((m) => m.client === me)?.name ?? myName(); return; }
  setMyName(name);
  room.rename(name);
});
$('player-names').addEventListener('keydown', (e) => { if (e.key === 'Enter' && room) (e.target as HTMLInputElement).blur(); });
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-room').click(); });
$('copy-link').addEventListener('click', async () => {
  if (!room) return;
  try { await navigator.clipboard.writeText(roomLink(room.code)); $('copy-link').textContent = 'Copied!'; } catch { $('copy-link').textContent = room.code; }
  setTimeout(() => { $('copy-link').textContent = 'Copy link'; }, 1500);
});
$('leave-room').addEventListener('click', () => {
  room?.close();
  room = null; lobby = null; members = [];
  leaveRoomLink();
  $('setup').classList.remove('online-guest');
  renderPlayers();
  renderRoom();
});
// A room link: join straight away (a started game resumes where it is). Also when a link is
// pasted into a tab that's already open (only the #hash changes, so the page doesn't reload).
const roomInHash = () => location.hash.match(/^#room=([A-Za-z0-9]{4,8})$/)?.[1].toUpperCase() ?? null;
const linked = roomInHash();
if (ROOMS_URL && linked) void enterRoom(linked, false);
window.addEventListener('hashchange', () => {
  const code = roomInHash();
  if (!ROOMS_URL || !code || launched || room?.code === code || !$('name-ask').hidden) return;
  void enterRoom(code, false);
});

/** Start (or rejoin) the room's game. */
async function launch(l: Lobby): Promise<void> {
  if (launched || !room) return;
  launched = true;
  const id = (COURSES.some((c) => c.id === l.course) ? l.course : 'simple') as CourseId;
  $('setup').hidden = true;
  $('settings-btn').hidden = false;
  $('fp-toggle').hidden = false;
  $('pause-sub').textContent = `${COURSES.find((c) => c.id === id)!.name}${l.crazy ? ' · Crazy mode' : ''} · Room ${room.code}`;
  const r = room;
  const { startDisc } = await import('./modes/disc');
  await startDisc({
    names: l.seats.map((q) => q.name), course: id, first: l.first, count: l.count, rogue: l.crazy,
    net: { room: r, isHost: me === host, mine: (p) => l.seats[p]?.client === me, log: roomLog },
    rules, // only the host's are used: they send them as the round's first event
  });
}

// ---------- start ----------
$('start').addEventListener('click', async () => {
  if (room) {
    if (!amHost()) return;
    save('sat-golf:menu', { course, holes: $<HTMLSelectElement>('holes').value, players, crazy: crazy.checked });
    pushLobby();
    room.start();
    return;
  }
  const typed = [...$('player-names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`);
  const names = uniqueNames(typed);
  const holesV = $<HTMLSelectElement>('holes').value;
  save('sat-golf:names', typed);
  save('sat-golf:menu', { course, holes: holesV, players, crazy: crazy.checked });
  $('setup').hidden = true;
  $('settings-btn').hidden = false;
  $('fp-toggle').hidden = false;
  const n = COURSES.find((c) => c.id === course)!.holes;
  const [first, count] = holesV.split(':').map((x) => parseInt(x, 10));
  $('pause-sub').textContent = `${COURSES.find((c) => c.id === course)!.name}${crazy.checked ? ' · Crazy mode' : ''}`;
  const { startDisc } = await import('./modes/disc');
  await startDisc({ names, course, first, count: Math.min(count, n - first), rogue: crazy.checked, rules });
});
