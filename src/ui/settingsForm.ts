// One settings form, rendered into both the main menu and the pause menu, in tabs: Audio, Camera,
// Gameplay, Graphics, Controls. Every control writes through to prefs/units, and both copies
// refresh when anything changes.
import { DEFAULT_KEYS, KEY_GROUPS, UNBINDABLE, bindKey, keyBindings, keyName, resetKeys, type KeyAction } from '../keys';
import { prefs, setPref, type Graphics, type Prefs } from '../settings';
import { getUnits, setUnits } from '../units';

type Tab = 'audio' | 'camera' | 'gameplay' | 'graphics' | 'controls';
const TABS: [Tab, string][] = [['audio', 'Audio'], ['camera', 'Camera'], ['gameplay', 'Gameplay'], ['graphics', 'Graphics'], ['controls', 'Controls']];
type Flag = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];

const toggle = (k: Flag, title: string, note = '', off = '') => {
  const p = prefs();
  return `<label class="toggle${off ? ' disabled' : ''}"><input type="checkbox" data-k="${k}" ${p[k] && !off ? 'checked' : ''} ${off ? 'disabled' : ''}><span class="switch"></span>
    <span class="toggle-text"><b>${title}</b>${off || note ? `<small>${off || note}</small>` : ''}</span></label>`;
};

export function mountSettings(el: HTMLElement): void {
  let quiet = false;
  let tab: Tab = 'audio';
  /** Controls: the action waiting for its new key. */
  let listening: KeyAction | null = null;

  const body = (): string => {
    const p = prefs();
    const calm = p.reduceMotion ? 'Off: Reduce motion is on (Graphics)' : '';
    switch (tab) {
      case 'audio': return `
        <div class="row"><span>Music</span><input type="range" min="0" max="100" step="5" data-k="music" value="${Math.round(p.music * 100)}"><span class="val">${Math.round(p.music * 100)}%</span></div>
        <div class="row"><span>Effects</span><input type="range" min="0" max="100" step="5" data-k="sfx" value="${Math.round(p.sfx * 100)}"><span class="val">${Math.round(p.sfx * 100)}%</span></div>
        ${toggle('muted', 'All sound off', 'Keeps the volumes for when it comes back on')}`;
      case 'camera': return `
        ${toggle('firstPerson', 'Start in first person', 'The view key switches to the map any time')}
        <div class="row"><span>Field of view</span><input type="range" min="45" max="100" step="1" data-k="fov" value="${p.fov}"><span class="val">${p.fov}°</span></div>
        <div class="row"><span>Look speed</span><input type="range" min="25" max="300" step="5" data-k="lookSpeed" value="${Math.round(p.lookSpeed * 100)}"><span class="val">${p.lookSpeed.toFixed(2)}×</span></div>
        ${toggle('invertLook', 'Invert look up / down', 'First person: dragging up looks down')}
        ${toggle('replays', 'Throw replays', 'Chase-cam replay after each throw', calm)}
        ${toggle('follow', "Follow friends' throws", 'Online: ride along with the chase cam as they fly', calm)}
        ${toggle('flyovers', 'Hole flyovers', 'Fly down each hole before the first throw', calm)}
        <div class="row"><span>Flight speed</span><div class="seg" data-k="playback">
          ${[1, 1.5, 2].map((v) => `<button data-v="${v}" class="${p.playback === v ? 'on' : ''}">${v}×</button>`).join('')}</div></div>`;
      case 'gameplay': return `
        <div class="row"><span>Units</span><div class="seg" data-k="units">
          <button data-v="imperial" class="${getUnits() === 'imperial' ? 'on' : ''}">Feet</button>
          <button data-v="metric" class="${getUnits() === 'metric' ? 'on' : ''}">Meters</button></div></div>
        ${toggle('ghosts', 'Ghost disc', 'Your best tee shot on each hole flies alongside the next one (not in Crazy mode)')}
        ${toggle('quickSolo', 'Quick turns when playing alone', 'No replay, and your next throw is ready as soon as the disc stops')}
        ${toggle('confirmLeave', 'Ask before leaving a round', 'The browser checks before you close or reload mid-round')}
        ${toggle('help', 'Show control hints')}`;
      case 'graphics': return `
        <div class="row"><span>Graphics</span><div class="seg" data-k="graphics">
          ${(['low', 'medium', 'high'] as const).map((v) => `<button data-v="${v}" class="${p.graphics === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
        ${toggle('weather', 'Weather and time of day', 'Each round: sun, golden hour, overcast or rain (looks only)')}
        ${toggle('reduceMotion', 'Reduce motion', 'Camera cuts instead of gliding; no flyovers, replays or follow cam; no menu animations')}
        ${toggle('fps', 'Show frame rate')}`;
      case 'controls': {
        const keys = keyBindings();
        return `${KEY_GROUPS.map((g) => `<div class="key-group"><h4>${g.name}</h4>${g.actions.map(([a, label]) => `
          <div class="row key-row"><span>${label}</span><button class="key-btn ${listening === a ? 'listening' : ''} ${keys[a] !== DEFAULT_KEYS[a] ? 'changed' : ''}" data-a="${a}">${listening === a ? 'Press a key…' : keyName(keys[a])}</button></div>`).join('')}</div>`).join('')}
          <div class="key-foot"><small>Click a key, then press the new one (Esc cancels). A key already in use swaps over.</small><button class="reset-keys">Reset to defaults</button></div>`;
      }
    }
  };

  const render = () => {
    el.innerHTML = `<div class="seg settings-tabs" role="tablist">${TABS.map(([id, name]) => `<button role="tab" data-tab="${id}" class="${tab === id ? 'on' : ''}" aria-selected="${tab === id}">${name}</button>`).join('')}</div>
      <div class="settings-body">${body()}</div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab as Tab; listening = null; render(); }));
    el.querySelectorAll<HTMLButtonElement>('.settings-body .seg button').forEach((b) => b.addEventListener('click', () => {
      const k = (b.parentElement as HTMLElement).dataset.k!;
      if (k === 'units') setUnits(b.dataset.v as 'metric' | 'imperial');
      else if (k === 'playback') setPref('playback', parseFloat(b.dataset.v!));
      else if (k === 'graphics') setPref('graphics', b.dataset.v as Graphics);
    }));
    el.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => i.addEventListener('change', () => setPref(i.dataset.k as Flag, i.checked)));
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => {
      const k = r.dataset.k as 'fov' | 'music' | 'sfx' | 'lookSpeed';
      const val = r.nextElementSibling!;
      const shown = () => (k === 'fov' ? `${r.value}°` : k === 'lookSpeed' ? `${(parseInt(r.value, 10) / 100).toFixed(2)}×` : `${r.value}%`);
      r.addEventListener('input', () => {
        val.textContent = shown();
        // Volumes apply while dragging (without re-rendering this form, which would drop the
        // slider mid-drag); field of view and look speed when let go.
        if (k === 'music' || k === 'sfx') { quiet = true; setPref(k, parseInt(r.value, 10) / 100); quiet = false; }
      });
      if (k === 'fov') r.addEventListener('change', () => setPref('fov', parseInt(r.value, 10)));
      if (k === 'lookSpeed') r.addEventListener('change', () => setPref('lookSpeed', parseInt(r.value, 10) / 100));
    });
    el.querySelectorAll<HTMLButtonElement>('.key-btn').forEach((b) => b.addEventListener('click', () => {
      listening = listening === b.dataset.a ? null : (b.dataset.a as KeyAction);
      render();
    }));
    el.querySelector('.reset-keys')?.addEventListener('click', () => { listening = null; resetKeys(); });
  };

  // Waiting for a new key: the next press is it (and nothing else in the game sees it).
  window.addEventListener('keydown', (e) => {
    if (!listening || !el.isConnected || el.offsetParent === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const a = listening;
    listening = null;
    const k = e.key.toLowerCase();
    if (k === 'escape' || UNBINDABLE.has(k)) { render(); return; }
    bindKey(a, k); // prefschange redraws
  }, true);

  render();
  window.addEventListener('prefschange', () => { if (!quiet) render(); });
  window.addEventListener('unitschange', render);
}
