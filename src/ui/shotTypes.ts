// The shot type picker: how throws are input (src/modes/throwStyles.ts). In Settings → Shot type,
// on the driving range's panel and on the putting card; each writes the pref, and the next throw
// (and the HUD's meter) picks it up.
import { prefs, setPref } from '../settings';
import { ENABLED_STYLES, THROW_STYLES, usableStyle, type ThrowStyle } from '../modes/throwStyles';

/** The picker's buttons, the current one on. */
export function shotTypeSeg(): string {
  const now = usableStyle(prefs().throwStyle);
  return `<div class="seg shot-types">${THROW_STYLES.filter(([v]) => ENABLED_STYLES.includes(v)).map(([v, name, text]) => `<button data-shot-type="${v}" class="${now === v ? 'on' : ''}" title="${text}">${name}</button>`).join('')}</div>`;
}

/** What the current shot type is, in a sentence. */
export const shotTypeText = () => `${THROW_STYLES.find(([v]) => v === usableStyle(prefs().throwStyle))?.[2] ?? ''}.`;

/** Wire the picker's buttons inside `root`. */
export function wireShotTypes(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-shot-type]').forEach((b) => b.addEventListener('click', () => {
    b.blur(); // so Space throws rather than pressing it again
    setPref('throwStyle', b.dataset.shotType as ThrowStyle);
  }));
}
