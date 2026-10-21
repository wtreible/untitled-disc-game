// Display units. Physics is always meters; this only changes what the player reads.
// Disc golf: meters / feet. Golf: meters / yards.
export type Units = 'metric' | 'imperial';
export type Sport = 'disc' | 'golf';

const KEY = 'sat-golf:units';
const FT = 3.28084;
const YD = 1 / 0.9144;

let units: Units = (() => {
  try { return localStorage.getItem(KEY) === 'imperial' ? 'imperial' : 'metric'; } catch { return 'metric'; }
})();

export function getUnits(): Units {
  return units;
}

/** Change units and notify listeners (HUDs re-render on 'unitschange'). */
export function setUnits(u: Units): void {
  units = u;
  try { localStorage.setItem(KEY, u); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('unitschange'));
}

export function unitLabel(sport: Sport = 'disc'): string {
  return units === 'metric' ? 'm' : sport === 'golf' ? 'yd' : 'ft';
}

/** Meters → display number in the current units. */
export function toDisplay(m: number, sport: Sport = 'disc'): number {
  return units === 'metric' ? m : m * (sport === 'golf' ? YD : FT);
}

/** Wind speed: "3 m/s" / "7 mph". */
export function fmtSpeed(ms: number): string {
  return units === 'metric' ? `${Math.round(ms)} m/s` : `${Math.round(ms * 2.23694)} mph`;
}

/** "123 ft" / "37 m". Distances under 10 display units get one decimal when `fine`. */
export function fmtLen(m: number, sport: Sport = 'disc', fine = false): string {
  const v = toDisplay(m, sport);
  const n = fine && Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${n} ${unitLabel(sport)}`;
}

/** Convert "4 m" / "0.6 m" / "1 m → 1.6 m" in free text (powerup descriptions) to the current units. */
export function convertText(s: string, sport: Sport = 'disc'): string {
  if (units === 'metric') return s;
  return s.replace(/(\d+(?:\.\d+)?) m\b/g, (_, n: string) => fmtLen(parseFloat(n), sport, true));
}
