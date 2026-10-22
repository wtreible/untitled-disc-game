// Rooms helpers (src/net/room.ts): the server address from the build variable, tidied; distinct names.
import { describe, expect, it } from 'vitest';
import { roomsUrl, uniqueNames } from '../src/net/room';

describe('roomsUrl', () => {
  it('drops trailing slashes (they made every request //room/CODE)', () => {
    expect(roomsUrl('wss://rooms.example.workers.dev/')).toBe('wss://rooms.example.workers.dev');
    expect(roomsUrl('wss://rooms.example.workers.dev//')).toBe('wss://rooms.example.workers.dev');
    expect(roomsUrl('wss://rooms.example.workers.dev')).toBe('wss://rooms.example.workers.dev');
  });
  it('turns http(s) into ws(s), trims spaces, and treats empty as not configured', () => {
    expect(roomsUrl(' https://rooms.example.workers.dev/ ')).toBe('wss://rooms.example.workers.dev');
    expect(roomsUrl('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787');
    expect(roomsUrl('')).toBeNull();
  });
});

describe('uniqueNames', () => {
  it('leaves distinct names alone and numbers repeats (ignoring case) with 2 digits', () => {
    expect(uniqueNames(['Sam', 'Alex'])).toEqual(['Sam', 'Alex']);
    const out = uniqueNames(['Sam', 'sam', 'Sam'], ['c1', 'c2', 'c3']);
    expect(out[0]).toBe('Sam');
    expect(out[1]).toMatch(/^sam \d{2}$/);
    expect(out[2]).toMatch(/^Sam \d{2}$/);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(3);
  });
  it('keeps the same number for the same key, and stays within 16 characters', () => {
    const a = uniqueNames(['Jo', 'Jo'], ['host', 'guest']);
    expect(uniqueNames(['Jo', 'Jo', 'Kim'], ['host', 'guest', 'other'])[1]).toBe(a[1]);
    const long = uniqueNames(['Sixteen-letters!', 'Sixteen-letters!']);
    expect(long[1].length).toBeLessThanOrEqual(16);
    expect(uniqueNames(['  ', ''])).toEqual(['Player', expect.stringMatching(/^Player \d{2}$/)]);
  });
});
