// Which key does what: one table for the game, quick chat and the menus, rebindable in Settings →
// Controls (saved in prefs). Keys are KeyboardEvent.key, lowercased (' ' is Space). Esc, the
// arrow-key fine steps (Shift) and quick chat's 1–8 stay as they are.
import { prefs, setPref } from './settings';

export type KeyAction =
  | 'throw' | 'fast-forward'
  | 'disc-prev' | 'disc-next' | 'aim-left' | 'aim-right' | 'look-up' | 'look-down'
  | 'target-farther' | 'target-closer' | 'hyzer' | 'anhyzer' | 'forehand' | 'shot'
  | 'mulligan' | 'perfect' | 'first-person' | 'view' | 'reframe' | 'replay-reset'
  | 'chat' | 'mute' | 'help';

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  throw: ' ', 'fast-forward': 'shift',
  'disc-prev': '[', 'disc-next': ']',
  'aim-left': 'arrowleft', 'aim-right': 'arrowright', 'look-up': 'arrowup', 'look-down': 'arrowdown',
  'target-farther': 'w', 'target-closer': 's',
  hyzer: 'q', anhyzer: 'e', forehand: 't', shot: 'g',
  mulligan: 'm', perfect: 'p',
  'first-person': 'c', view: 'v', reframe: 'f', 'replay-reset': 'r',
  chat: 'z', mute: 'n', help: '?',
};

/** The Controls list: what each action is called, in groups. */
export const KEY_GROUPS: { name: string; actions: [KeyAction, string][] }[] = [
  { name: 'Throw', actions: [['throw', 'Throw (hold, let go) · skip a replay or flyover'], ['disc-prev', 'Previous disc'], ['disc-next', 'Next disc'], ['hyzer', 'Hyzer'], ['anhyzer', 'Anhyzer'], ['forehand', 'Backhand / forehand'], ['shot', 'Shot: normal, tomahawk, thumber, roller'], ['mulligan', 'Crazy mode: mulligan'], ['perfect', 'Crazy mode: Perfect Form']] },
  { name: 'Aim', actions: [['aim-left', 'Turn left'], ['aim-right', 'Turn right'], ['look-up', 'Launch angle up (first person)'], ['look-down', 'Launch angle down (first person)'], ['target-farther', 'Target farther'], ['target-closer', 'Target closer']] },
  { name: 'View', actions: [['first-person', 'First person / top-down'], ['view', 'Map style'], ['reframe', 'Re-frame (top-down)'], ['fast-forward', 'Fast-forward a flight (hold)'], ['replay-reset', 'Replay: reset the camera']] },
  { name: 'Other', actions: [['chat', 'Quick chat (hold)'], ['mute', 'Sound on / off'], ['help', 'Controls list']] },
];

/** Every action's key: the defaults, with the player's changes. */
export function keyBindings(): Record<KeyAction, string> {
  return { ...DEFAULT_KEYS, ...prefs().keys };
}

const keyOf = (e: KeyboardEvent) => e.key.toLowerCase();

/** The action a key press asks for, if any. */
export function keyAction(e: KeyboardEvent): KeyAction | null {
  const k = keyOf(e);
  for (const [a, key] of Object.entries(keyBindings())) if (key === k) return a as KeyAction;
  return null;
}

/** Is this key event the one bound to `a`? */
export const isKey = (e: KeyboardEvent, a: KeyAction): boolean => keyOf(e) === keyBindings()[a];

/**
 * Bind `key` to `a`. An action that had that key takes `a`'s old one, so no key does two things.
 */
export function bindKey(a: KeyAction, key: string): void {
  const now = keyBindings();
  const k = key.toLowerCase();
  const next: Partial<Record<KeyAction, string>> = { ...prefs().keys, [a]: k };
  for (const [b, kb] of Object.entries(now) as [KeyAction, string][]) if (b !== a && kb === k) next[b] = now[a];
  // Keep only what differs from the defaults.
  for (const b of Object.keys(next) as KeyAction[]) if (next[b] === DEFAULT_KEYS[b]) delete next[b];
  setPref('keys', next);
}

export function resetKeys(): void {
  setPref('keys', {});
}

const NAMES: Record<string, string> = {
  ' ': 'Space', shift: 'Shift', control: 'Ctrl', alt: 'Alt', meta: 'Meta', enter: 'Enter', tab: 'Tab', backspace: 'Backspace',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
};
/** How a key is written: "Space", "←", "Q". */
export const keyName = (k: string): string => NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
/** The key bound to `a`, written out. */
export const keyFor = (a: KeyAction): string => keyName(keyBindings()[a]);
/** Keys that can't be bound: Esc opens menus, and these do nothing on their own. */
export const UNBINDABLE = new Set(['escape', 'dead', 'unidentified', 'capslock', 'meta', 'contextmenu']);
