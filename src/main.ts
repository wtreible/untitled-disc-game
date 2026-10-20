// Setup screen: pick the game and players, then hand off to a mode. Modes own the page after that;
// "Play again" reloads, which brings this screen back with the last names filled in.
import { PLAYER_COLORS } from './game/game';
import { getUnits, setUnits, type Units } from './units';
import { replaysOn, setReplays } from './settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const load = <T>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; }
};
const save = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
};

const savedNames = load<string[]>('sat-golf:names', []);

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

// Holes menu for disc golf: full round, nines, or any single hole.
const holeOptions: { label: string; first: number; count: number }[] = [
  { label: 'Full round (18)', first: 0, count: 18 },
  { label: 'Front 9', first: 0, count: 9 },
  { label: 'Back 9', first: 9, count: 9 },
  ...Array.from({ length: 18 }, (_, i) => ({ label: `Hole ${i + 1} only`, first: i, count: 1 })),
];
$('holes').innerHTML = holeOptions.map((o, i) => `<option value="${i}">${o.label}</option>`).join('');

function syncMode(): void {
  const mode = $<HTMLSelectElement>('mode').value;
  $('holes-row').hidden = mode === 'golf' || mode === 'disc-rogue'; // runs are always 18 holes
  $('setup-hole').textContent = {
    'disc-simple': 'Tali disc golf park layout, drawn simply: 1–5 trees per hole, a defender guarding every basket. Starts in first person.',
    'disc-forest': 'Tali disc golf park over satellite imagery: ~10k trees from HSY 2024 canopy data. Starts in first person.',
    'disc-silly': 'A full-size disc golf course themed like mini golf: a giant windmill (thread the tunnel or dodge the blades), a castle gate, giant animals, mushrooms and golf balls.',
    'disc-rogue': 'Roguelike run: 18 holes on the simple Tali course. Start with a starter augment, then draft 1 of 3 after every hole. Earn your ghost line; hex your friends.',
    golf: 'The Country Club, Brookline MA: Main course hole 17, par 4.',
  }[mode] ?? '';
}

const last = load<{ mode?: string; holes?: string; players?: string }>('sat-golf:setup', {});
// Saved modes from older versions ('disc') fall back to the default.
if (last.mode && [...$<HTMLSelectElement>('mode').options].some((o) => o.value === last.mode)) $<HTMLSelectElement>('mode').value = last.mode;
if (last.holes) $<HTMLSelectElement>('holes').value = last.holes;
if (last.players) $<HTMLSelectElement>('player-count').value = last.players;
$('mode').addEventListener('change', syncMode);
$('player-count').addEventListener('change', renderNameInputs);
syncMode();
renderNameInputs();

// Units: on the setup screen and in the in-game settings menu (⚙ / Esc).
for (const id of ['units-setup', 'units-game']) {
  const sel = $<HTMLSelectElement>(id);
  sel.value = getUnits();
  sel.addEventListener('change', () => setUnits(sel.value as Units));
}
window.addEventListener('unitschange', () => {
  for (const id of ['units-setup', 'units-game']) $<HTMLSelectElement>(id).value = getUnits();
});
const replaysBox = $<HTMLInputElement>('replays');
replaysBox.checked = replaysOn();
replaysBox.addEventListener('change', () => setReplays(replaysBox.checked));
const openSettings = (open: boolean) => { $('settings').hidden = !open; };
$('settings-btn').addEventListener('click', () => openSettings(true));
$('settings-close').addEventListener('click', () => openSettings(false));
$('settings-menu').addEventListener('click', () => location.reload());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('setup').hidden === true) openSettings($('settings').hidden === true);
});

$('start').addEventListener('click', async () => {
  const names = [...$('player-names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`);
  const mode = $<HTMLSelectElement>('mode').value;
  save('sat-golf:names', names);
  save('sat-golf:setup', { mode, holes: $<HTMLSelectElement>('holes').value, players: $<HTMLSelectElement>('player-count').value });
  $('setup').hidden = true;
  $('settings-btn').hidden = false;
  if (mode === 'golf') {
    $('release').hidden = true;
    const { startGolf } = await import('./modes/golf');
    await startGolf(names);
  } else {
    const o = holeOptions[parseInt($<HTMLSelectElement>('holes').value, 10)];
    $('fp-toggle').hidden = false;
    const { startDisc } = await import('./modes/disc');
    const rogue = mode === 'disc-rogue';
    const course = mode === 'disc-forest' ? 'forest' : mode === 'disc-silly' ? 'silly' : 'simple';
    // Mini Golf Madness has 9 holes: clamp the hole menu to it.
    const n = course === 'silly' ? 9 : 18;
    const first = rogue ? 0 : Math.min(o.first, n - 1);
    await startDisc({ names, course, first, count: rogue ? 18 : Math.min(o.count, n - first), rogue });
  }
});
