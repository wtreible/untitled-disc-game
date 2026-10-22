// Driving range side panel: wind and weather controls, the flight-line toggle, tools to place and
// remove baskets and trees, and the last few throws. The setup is saved per browser.
import type { Vec2 } from '../course/geo';
import { DEFAULT_BASKETS, type RangeConditions } from '../course/range';
import { WEATHER, type WeatherId } from '../render/weather';
import { sfx } from '../audio/sound';
import { fmtLen, fmtSpeed } from '../units';

/** The range as this browser last set it (saved), plus this viewer's own flight-line toggle. */
export interface RangeSetup extends RangeConditions {
  /** Show the dashed line a perfect throw would fly. */
  ghost: boolean;
}

export type RangeTool = 'basket' | 'tree' | 'remove';

/** A player on the range: their throws so far and the longest, and whether they're up. */
export interface RangePlayer { name: string; color: string; throws: number; longest: number; up: boolean }

export interface RangeShot { who: string; color: string; disc: string; dist: number; side: number; holed: boolean }

const KEY = 'sat-golf:range';
const MAX_WIND = 10;
/** A fresh range: the default baskets, no trees, calm and sunny. */
export const freshRange = (): RangeSetup => ({ baskets: DEFAULT_BASKETS.map((b): Vec2 => [b[0], b[1]]), trees: [], windSpeed: 0, windFrom: 0, weather: 'clear', ghost: true });

export function loadRange(): RangeSetup {
  try {
    const s = { ...freshRange(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as RangeSetup;
    if (!(s.weather in WEATHER)) s.weather = 'clear';
    return s;
  } catch { return freshRange(); }
}

export function saveRange(s: RangeSetup): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const DIRS: [number, string][] = [[0, 'Head'], [90, 'From right'], [180, 'Tail'], [270, 'From left']];
function dirLabel(from: number): string {
  const names = ['Headwind', 'Head, from the right', 'From the right', 'Tail, from the right', 'Tailwind', 'Tail, from the left', 'From the left', 'Head, from the left'];
  return names[Math.round((((from % 360) + 360) % 360) / 45) % 8];
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TOOL_HINT: Record<RangeTool, string> = {
  basket: 'Click the map to place a basket',
  tree: 'Click the map to plant a tree',
  remove: 'Click a basket or tree to remove it',
};

export interface RangeCallbacks {
  /** Wind, weather or the flight line changed (saved here; the range is sent by the caller). */
  change(what: 'wind' | 'weather' | 'ghost'): void;
  tool(t: RangeTool | null): void;
  clearLines(): void;
  /** Back to the default baskets, no trees. */
  reset(): void;
}

/**
 * `s` is this browser's copy of the range: the panel edits it, the caller sends it on, and puts the
 * room's range back into it (then refresh()) when someone else changes it.
 */
export function mountRangePanel(el: HTMLElement, s: RangeSetup, cb: RangeCallbacks) {
  let tool: RangeTool | null = null;
  let shots: RangeShot[] = [];
  let players: RangePlayer[] = [];
  /** Someone else's turn: the conditions and course are theirs to set (the flight line stays ours). */
  let lockedBy: { name: string; color: string } | null = null;
  const off = () => (lockedBy ? 'disabled' : '');
  const render = () => {
    el.innerHTML = `
      <div class="rp-head">DRIVING RANGE</div>
      ${lockedBy ? `<div class="rp-lock"><i style="background:${lockedBy.color}"></i>${esc(lockedBy.name)} sets the range this turn</div>` : ''}
      <section><h4>Wind <b class="rp-val" data-v="wind">${s.windSpeed < 0.5 ? 'Calm' : `${fmtSpeed(s.windSpeed)} · ${dirLabel(s.windFrom)}`}</b></h4>
        <input type="range" min="0" max="${MAX_WIND}" step="0.5" data-k="speed" value="${s.windSpeed}" title="Wind speed" ${off()}>
        <div class="seg rp-seg" data-k="dir">${DIRS.map(([d, l]) => `<button data-v="${d}" class="${s.windFrom === d ? 'on' : ''}" ${off()}>${l}</button>`).join('')}</div>
        <input type="range" min="0" max="345" step="15" data-k="from" value="${s.windFrom}" title="Wind direction" ${off()}></section>
      <section><h4>Weather</h4>
        <div class="seg rp-seg" data-k="weather">${Object.values(WEATHER).map((w) => `<button data-v="${w.id}" class="${s.weather === w.id ? 'on' : ''}" ${off()}>${w.label}</button>`).join('')}</div></section>
      <label class="toggle small"><input type="checkbox" data-k="ghost" ${s.ghost ? 'checked' : ''}><span class="switch"></span>
        <span class="toggle-text"><b>Flight line</b><small>Where a perfect throw goes</small></span></label>
      <section><h4>Course</h4>
        <div class="rp-tools">
          <button data-tool="basket" class="${tool === 'basket' ? 'on' : ''}" ${off()}>+ Basket</button>
          <button data-tool="tree" class="${tool === 'tree' ? 'on' : ''}" ${off()}>+ Tree</button>
          <button data-tool="remove" class="${tool === 'remove' ? 'on' : ''}" ${off()}>Remove</button>
        </div>
        ${tool ? `<div class="rp-hint">${TOOL_HINT[tool]} · click the button again when done</div>` : ''}
        <div class="rp-tools">
          <button data-act="lines">Clear lines</button>
          <button data-act="reset" ${off()}>Reset range</button>
        </div></section>
      ${players.length > 1 ? `<section class="rp-players"><h4>Players <span>Longest</span></h4>${players.map((q) => `<div class="rp-player ${q.up ? 'up' : ''}"><span><i style="background:${q.color}"></i>${esc(q.name)}<small>${q.throws} ${q.throws === 1 ? 'throw' : 'throws'}</small></span><b>${q.throws ? fmtLen(q.longest) : '–'}</b></div>`).join('')}</section>` : ''}
      <section class="rp-shots"><h4>Last throws</h4>${shots.length
        ? shots.map((q) => `<div class="rp-shot"><span><i style="background:${q.color}"></i>${esc(q.who)} · ${q.disc}</span><b>${q.holed ? 'Chains!' : fmtLen(q.dist)}</b><small>${q.holed ? fmtLen(q.dist) : Math.abs(q.side) < 1 ? 'on line' : `${fmtLen(Math.abs(q.side))} ${q.side < 0 ? 'left' : 'right'}`}</small></div>`).join('')
        : '<div class="rp-none">Throw a few: distances show here</div>'}</section>`;
    // Buttons give focus back to the page, so Space throws instead of pressing them again.
    const click = (sel: string, fn: (b: HTMLButtonElement) => void) => el.querySelectorAll<HTMLButtonElement>(sel).forEach((b) => b.addEventListener('click', () => { b.blur(); sfx('select'); fn(b); }));
    click('[data-k=dir] button', (b) => { s.windFrom = parseInt(b.dataset.v!, 10); if (s.windSpeed < 0.5) s.windSpeed = 3; changed('wind'); });
    click('[data-k=weather] button', (b) => { s.weather = b.dataset.v as WeatherId; changed('weather'); });
    click('[data-tool]', (b) => setTool(tool === b.dataset.tool ? null : (b.dataset.tool as RangeTool)));
    click('[data-act=lines]', () => cb.clearLines());
    click('[data-act=reset]', () => { setTool(null); cb.reset(); });
    for (const k of ['speed', 'from'] as const) {
      const r = el.querySelector<HTMLInputElement>(`input[data-k=${k}]`)!;
      // Dragging shows the value; letting go sets the wind (one change for the room, not dozens).
      r.addEventListener('input', () => {
        if (k === 'speed') s.windSpeed = parseFloat(r.value); else s.windFrom = parseInt(r.value, 10);
        el.querySelector('[data-v=wind]')!.textContent = s.windSpeed < 0.5 ? 'Calm' : `${fmtSpeed(s.windSpeed)} · ${dirLabel(s.windFrom)}`;
        el.querySelectorAll<HTMLButtonElement>('[data-k=dir] button').forEach((b) => b.classList.toggle('on', parseInt(b.dataset.v!, 10) === s.windFrom));
      });
      r.addEventListener('change', () => { r.blur(); changed('wind'); }); // blur: arrow keys aim again
    }
    el.querySelector<HTMLInputElement>('input[data-k=ghost]')!.addEventListener('change', (e) => {
      s.ghost = (e.target as HTMLInputElement).checked;
      (e.target as HTMLInputElement).blur();
      changed('ghost');
    });
  };
  const changed = (what: 'wind' | 'weather' | 'ghost') => { saveRange(s); cb.change(what); render(); };
  const setTool = (t: RangeTool | null) => { tool = t; cb.tool(t); render(); };
  render();
  window.addEventListener('unitschange', render);
  return {
    get tool() { return tool; },
    setTool,
    addShot(q: RangeShot) { shots = [q, ...shots].slice(0, 6); render(); },
    setPlayers(list: RangePlayer[]) {
      if (JSON.stringify(list) === JSON.stringify(players)) return;
      players = list;
      render();
    },
    /** `s` changed from outside (someone else's range). */
    refresh: render,
    /** Lock the panel for someone else's turn (null: ours). */
    lock(by: { name: string; color: string } | null) {
      if (by?.name === lockedBy?.name && !!by === !!lockedBy) return;
      lockedBy = by;
      if (by && tool) setTool(null);
      else render();
    },
  };
}
