// Main menu: course, players, round (holes / Crazy mode) and settings, then hand off to the disc
// golf mode. "Play again" / "Quit to main menu" reload, which brings the menu back with the last
// choices filled in. (Golf still lives in src/modes/golf.ts but isn't on the menu: disc only for now.)
import { PLAYER_COLORS } from './game/game';
import { mountSettings } from './ui/settingsForm';

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
    id: 'simple', group: 'real', name: 'Tali', meta: 'Helsinki, Finland · the real layout, drawn clean', holes: 18,
    blurb: 'The real Tali disc golf park layout from OpenStreetMap, drawn as a clean course: 1–5 trees per hole and a defender guarding every basket.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#3c4a37"/><path d="M8 58 C 20 40, 30 30, 50 8" stroke="#8cc063" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="20" cy="26" r="7" fill="#2f6a2f"/><circle cx="44" cy="40" r="6" fill="#2f6a2f"/><circle cx="50" cy="9" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'silly', group: 'arcade', name: 'Mini Golf Madness', meta: 'Windmills, castles, giant animals', holes: 9,
    blurb: 'A full-size course themed like mini golf: thread the giant windmill’s tunnel past spinning blades, fly a castle gate, dodge cows, penguins and giant golf balls.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#4f8f45"/><rect x="0" y="40" width="64" height="24" fill="#2fb24c"/><path d="M26 44 L29 22 L35 22 L38 44 Z" fill="#c9a27a"/><g transform="translate(32 24)" stroke="#8a4b2e" stroke-width="4" stroke-linecap="round"><path d="M-12 -12 L12 12 M12 -12 L-12 12"/></g><circle cx="32" cy="24" r="2.5" fill="#999"/><circle cx="50" cy="50" r="5" fill="#e2504f"/></svg>`,
  },
  {
    id: 'forest', group: 'real', name: 'Tali Forest', meta: 'Satellite imagery · 10k real-canopy trees', holes: 18,
    blurb: 'The same Tali holes over live satellite imagery, with ~10,000 trees placed from Helsinki’s 2024 canopy data. Tight and woody.',
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
let players = Math.min(4, Math.max(1, last.players ?? 2));
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
  }));
  $('setup-hole').textContent = COURSES.find((c) => c.id === course)!.blurb;
}

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
}

// ---------- players ----------
function renderPlayers(): void {
  $('player-seg').innerHTML = [1, 2, 3, 4].map((k) => `<button data-n="${k}" class="${k === players ? 'on' : ''}">${k} ${k === 1 ? 'player' : 'players'}</button>`).join('');
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
const syncCrazy = () => { $('holes-row').hidden = crazy.checked; }; // crazy runs play the full course
crazy.addEventListener('change', syncCrazy);

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
$('settings-menu').addEventListener('click', () => location.reload());
$('pause-card').addEventListener('click', () => { openPause(false); window.dispatchEvent(new Event('show-scorecard')); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('setup').hidden === true) openPause($('settings').hidden === true);
});

// ---------- start ----------
$('start').addEventListener('click', async () => {
  const names = [...$('player-names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`);
  const holesV = $<HTMLSelectElement>('holes').value;
  save('sat-golf:names', names);
  save('sat-golf:menu', { course, holes: holesV, players, crazy: crazy.checked });
  $('setup').hidden = true;
  $('settings-btn').hidden = false;
  $('fp-toggle').hidden = false;
  const n = COURSES.find((c) => c.id === course)!.holes;
  const [first, count] = crazy.checked ? [0, n] : holesV.split(':').map((x) => parseInt(x, 10));
  $('pause-sub').textContent = `${COURSES.find((c) => c.id === course)!.name}${crazy.checked ? ' · Crazy mode' : ''}`;
  const { startDisc } = await import('./modes/disc');
  await startDisc({ names, course, first, count: Math.min(count, n - first), rogue: crazy.checked });
});
