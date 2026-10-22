// One settings form, rendered into both the main menu and the pause menu. Every control writes
// through to prefs/units, and both copies refresh when anything changes.
import { prefs, setPref, type Graphics } from '../settings';
import { getUnits, setUnits } from '../units';

export function mountSettings(el: HTMLElement): void {
  const render = () => {
    const p = prefs();
    el.innerHTML = `
      <div class="row"><span>Units</span><div class="seg" data-k="units">
        <button data-v="imperial" class="${getUnits() === 'imperial' ? 'on' : ''}">Feet</button>
        <button data-v="metric" class="${getUnits() === 'metric' ? 'on' : ''}">Meters</button></div></div>
      <label class="toggle"><input type="checkbox" data-k="firstPerson" ${p.firstPerson ? 'checked' : ''}><span class="switch"></span>
        <span class="toggle-text"><b>Start in first person</b><small>C switches to the map any time</small></span></label>
      <label class="toggle"><input type="checkbox" data-k="replays" ${p.replays ? 'checked' : ''}><span class="switch"></span>
        <span class="toggle-text"><b>Throw replays</b><small>Chase-cam replay after each throw</small></span></label>
      <label class="toggle"><input type="checkbox" data-k="follow" ${p.follow ? 'checked' : ''}><span class="switch"></span>
        <span class="toggle-text"><b>Follow friends' throws</b><small>Online: ride along with the chase cam as they fly</small></span></label>
      <div class="row"><span>Field of view</span><input type="range" min="45" max="100" step="1" data-k="fov" value="${p.fov}"><span class="val">${p.fov}°</span></div>
      <div class="row"><span>Flight speed</span><div class="seg" data-k="playback">
        ${[1, 1.5, 2].map((v) => `<button data-v="${v}" class="${p.playback === v ? 'on' : ''}">${v}×</button>`).join('')}</div></div>
      <label class="toggle"><input type="checkbox" data-k="help" ${p.help ? 'checked' : ''}><span class="switch"></span>
        <span class="toggle-text"><b>Show control hints</b></span></label>
      <div class="row"><span>Graphics</span><div class="seg" data-k="graphics">
        ${(['low', 'medium', 'high'] as const).map((v) => `<button data-v="${v}" class="${p.graphics === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      <label class="toggle"><input type="checkbox" data-k="fps" ${p.fps ? 'checked' : ''}><span class="switch"></span>
        <span class="toggle-text"><b>Show frame rate</b></span></label>`;
    el.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.addEventListener('click', () => {
      const k = (b.parentElement as HTMLElement).dataset.k!;
      if (k === 'units') setUnits(b.dataset.v as 'metric' | 'imperial');
      else if (k === 'playback') setPref('playback', parseFloat(b.dataset.v!));
      else if (k === 'graphics') setPref('graphics', b.dataset.v as Graphics);
    }));
    el.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => i.addEventListener('change', () => {
      setPref(i.dataset.k as 'firstPerson' | 'replays' | 'follow' | 'help' | 'fps', i.checked);
    }));
    const fov = el.querySelector<HTMLInputElement>('input[type=range]')!;
    fov.addEventListener('input', () => { el.querySelector('.val')!.textContent = `${fov.value}°`; });
    fov.addEventListener('change', () => setPref('fov', parseInt(fov.value, 10)));
  };
  render();
  window.addEventListener('prefschange', render);
  window.addEventListener('unitschange', render);
}
