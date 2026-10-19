// Setup screen: pick the game and players, then hand off to a mode. Modes own the page after that;
// "Play again" reloads, which brings this screen back with the last names filled in.
import { PLAYER_COLORS } from './game/game';

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
  const disc = $<HTMLSelectElement>('mode').value === 'disc';
  $('holes-row').hidden = !disc;
  $('setup-hole').textContent = disc
    ? 'Tali disc golf park: 18 holes in mixed forest, trees from HSY 2024 canopy data.'
    : 'The Country Club, Brookline MA: Main course hole 17, par 4.';
}

const last = load<{ mode?: string; holes?: string; players?: string }>('sat-golf:setup', {});
if (last.mode) $<HTMLSelectElement>('mode').value = last.mode;
if (last.holes) $<HTMLSelectElement>('holes').value = last.holes;
if (last.players) $<HTMLSelectElement>('player-count').value = last.players;
$('mode').addEventListener('change', syncMode);
$('player-count').addEventListener('change', renderNameInputs);
syncMode();
renderNameInputs();

$('start').addEventListener('click', async () => {
  const names = [...$('player-names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`);
  const mode = $<HTMLSelectElement>('mode').value;
  save('sat-golf:names', names);
  save('sat-golf:setup', { mode, holes: $<HTMLSelectElement>('holes').value, players: $<HTMLSelectElement>('player-count').value });
  $('setup').hidden = true;
  if (mode === 'golf') {
    $('release').hidden = true;
    const { startGolf } = await import('./modes/golf');
    await startGolf(names);
  } else {
    const o = holeOptions[parseInt($<HTMLSelectElement>('holes').value, 10)];
    $('fp-toggle').hidden = false;
    const { startDisc } = await import('./modes/disc');
    await startDisc({ names, first: o.first, count: o.count });
  }
});
