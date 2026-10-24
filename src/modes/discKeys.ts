// The disc game's keys: which key does what. One table, so the help line, the keys card and
// (later) rebinding all read the same thing. Space (throw) and Shift (fast-forward) are handled
// where they're used.
export type KeyAction =
  | 'disc-prev' | 'disc-next' | 'aim-left' | 'aim-right' | 'look-up' | 'look-down'
  | 'target-farther' | 'target-closer' | 'hyzer' | 'anhyzer' | 'forehand' | 'shot'
  | 'mulligan' | 'perfect' | 'first-person' | 'view' | 'reframe' | 'replay-reset';

/** Default keys, by KeyboardEvent.key lowercased. */
export const DEFAULT_KEYS: Record<KeyAction, string> = {
  'disc-prev': '[', 'disc-next': ']',
  'aim-left': 'arrowleft', 'aim-right': 'arrowright', 'look-up': 'arrowup', 'look-down': 'arrowdown',
  'target-farther': 'w', 'target-closer': 's',
  hyzer: 'q', anhyzer: 'e', forehand: 't', shot: 'g',
  mulligan: 'm', perfect: 'p',
  'first-person': 'c', view: 'v', reframe: 'f', 'replay-reset': 'r',
};

/** The action a key press asks for, if any. */
export function keyAction(e: KeyboardEvent): KeyAction | null {
  const k = e.key.toLowerCase();
  for (const [a, key] of Object.entries(DEFAULT_KEYS)) if (key === k) return a as KeyAction;
  return null;
}
