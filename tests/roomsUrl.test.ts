// The rooms server address from the build variable, tidied (src/net/room.ts).
import { describe, expect, it } from 'vitest';
import { roomsUrl } from '../src/net/room';

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
