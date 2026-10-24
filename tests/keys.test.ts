// Rebinding keys (src/keys.ts): a taken key swaps over, only changes are saved, reset restores.
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    window: new EventTarget(),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  });
});

const ev = (key: string) => ({ key }) as KeyboardEvent;

describe('key bindings', () => {
  it('defaults, rebinding, swapping a taken key, and reset', async () => {
    const { DEFAULT_KEYS, bindKey, isKey, keyAction, keyBindings, keyName, resetKeys } = await import('../src/keys');
    const { prefs } = await import('../src/settings');
    expect(keyAction(ev('Q'))).toBe('hyzer'); // case doesn't matter
    expect(isKey(ev(' '), 'throw')).toBe(true);
    // A free key: just that action moves.
    bindKey('hyzer', 'u');
    expect(keyAction(ev('u'))).toBe('hyzer');
    expect(keyAction(ev('q'))).toBeNull();
    // A taken key: the other action gets this one's old key.
    bindKey('hyzer', 'e');
    expect(keyBindings().hyzer).toBe('e');
    expect(keyBindings().anhyzer).toBe('u');
    // Only what differs from the defaults is saved; binding back to a default drops it.
    expect(prefs().keys).toEqual({ hyzer: 'e', anhyzer: 'u' });
    bindKey('anhyzer', 'e'); // back to its default; hyzer, which had E, swaps onto U
    expect(prefs().keys).toEqual({ hyzer: 'u' });
    bindKey('hyzer', 'q');
    expect(prefs().keys).toEqual({});
    expect(keyBindings()).toEqual(DEFAULT_KEYS);
    bindKey('chat', 'x');
    resetKeys();
    expect(keyBindings()).toEqual(DEFAULT_KEYS);
    expect([keyName(' '), keyName('arrowleft'), keyName('q'), keyName('shift')]).toEqual(['Space', '←', 'Q', 'Shift']);
  });
});
