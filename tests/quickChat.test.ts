// Quick chat messages off the wire (src/ui/quickChat.ts): lines and emoji, nothing else.
import { describe, expect, it } from 'vitest';
import { CHAT_LINES, EMOJI, chatMsg } from '../src/ui/quickChat';

describe('quick chat messages', () => {
  it('reads lines and emoji by index, and refuses anything else', () => {
    expect(chatMsg({ chat: 0, player: 1 })).toEqual({ chat: 0 });
    expect(chatMsg({ emoji: EMOJI.length - 1, player: 0 })).toEqual({ emoji: EMOJI.length - 1 });
    expect(chatMsg({ chat: CHAT_LINES.length })).toBeNull();
    expect(chatMsg({ emoji: -1 })).toBeNull();
    expect(chatMsg({ emoji: '👏' })).toBeNull(); // never free text
    expect(chatMsg({ yaw: 1, target: [0, 0] })).toBeNull(); // live aim
    expect(chatMsg(null)).toBeNull();
  });
});
