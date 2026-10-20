// Player preferences other than units (src/units.ts). Saved per browser.
const REPLAYS = 'sat-golf:replays';

export function replaysOn(): boolean {
  try { return localStorage.getItem(REPLAYS) !== 'off'; } catch { return true; }
}

export function setReplays(on: boolean): void {
  try { localStorage.setItem(REPLAYS, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
}
