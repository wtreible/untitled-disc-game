// Settings → Gameplay → Ask before leaving a round: the browser's "Leave site?" while a round is in
// progress. The game's own reloads (quit, back to the lobby, rejoining a room) go through
// reloadPage, which doesn't ask.
import { prefs } from '../settings';

let inProgress: (() => boolean) | null = null;
let leaving = false;

/** A round is on: ask before leaving while `on()` says it still is. */
export function guardLeave(on: () => boolean): void {
  if (!inProgress) window.addEventListener('beforeunload', ask);
  inProgress = on;
}

const AGAIN = 'untitled-disc-game:again';

/** Reload without asking (the player chose this, or the game needs it). `again`: Play again, so the menu keeps the round's format, holes and layout. */
export function reloadPage(again = false): void {
  leaving = true;
  try { if (again) sessionStorage.setItem(AGAIN, '1'); } catch { /* storage unavailable */ }
  location.reload();
}

/** The menu's here because of Play again (once: it's cleared as it's read). */
export function cameForAgain(): boolean {
  try {
    const v = sessionStorage.getItem(AGAIN) === '1';
    sessionStorage.removeItem(AGAIN);
    return v;
  } catch { return false; }
}

function ask(e: BeforeUnloadEvent): void {
  if (leaving || !inProgress || !prefs().confirmLeave || !inProgress()) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers want it set
}
