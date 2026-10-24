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

/** Reload without asking (the player chose this, or the game needs it). */
export function reloadPage(): void {
  leaving = true;
  location.reload();
}

function ask(e: BeforeUnloadEvent): void {
  if (leaving || !inProgress || !prefs().confirmLeave || !inProgress()) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers want it set
}
