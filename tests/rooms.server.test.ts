// Room server protocol (server/src/index.ts), against a running server:
//
//   npm run server:dev                      # in one terminal
//   ROOMS_URL=ws://127.0.0.1:8787 npx vitest run tests/rooms.server.test.ts
//
// Skipped when ROOMS_URL isn't set.
import { describe, expect, it } from 'vitest';

const BASE = process.env.ROOMS_URL;
type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A test client: a socket plus a queue of received messages. */
async function connect(room: string, client: string, name: string) {
  const ws = new WebSocket(`${BASE}/room/${room}?client=${client}&name=${encodeURIComponent(name)}`);
  const inbox: Msg[] = [];
  const waiters: ((m: Msg) => void)[] = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    const w = waiters.shift();
    if (w) w(m); else inbox.push(m);
  });
  await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('connect failed'))); });
  const next = (timeout = 3000) => new Promise<Msg>((res, rej) => {
    const m = inbox.shift();
    if (m) return res(m);
    const t = setTimeout(() => rej(new Error('timed out waiting for a message')), timeout);
    waiters.push((x) => { clearTimeout(t); res(x); });
  });
  /** The next message of a type (skipping others, e.g. member updates). */
  const until = async (type: string) => { for (;;) { const m = await next(); if (m.type === type) return m; } };
  const send = (m: Msg) => ws.send(JSON.stringify(m));
  return { ws, next, until, send, close: () => ws.close() };
}

const room = () => `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const lobby = (seats: { name: string; client: string }[]) => ({ course: 'silly', first: 0, count: 9, crazy: false, seats });

describe.skipIf(!BASE)('room server', () => {
  it('host sets up and starts; events are ordered, acked, relayed and replayed to late joiners', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    const wa = await a.until('welcome');
    expect(wa.host).toBe('client-aaaa');
    expect(wa.log).toEqual([]);
    expect(wa.started).toBe(false);

    const b = await connect(code, 'client-bbbb', 'Bo');
    const wb = await b.until('welcome');
    expect(wb.host).toBe('client-aaaa');
    expect((await a.until('members')).members.map((m: Msg) => m.name).sort()).toEqual(['Ann', 'Bo']);

    // Only the host sets up the game; events before the start are refused.
    b.send({ type: 'lobby', lobby: lobby([]) });
    expect((await b.until('error')).reason).toMatch(/host/);
    b.send({ type: 'event', seq: 0, e: { t: 'hole-start', wind: [0, 0] } });
    expect((await b.until('error')).reason).toMatch(/not started/);

    a.send({ type: 'lobby', lobby: lobby([{ name: 'Ann', client: 'client-aaaa' }, { name: 'Bo', client: 'client-bbbb' }]) });
    expect((await b.until('lobby')).lobby.seats).toHaveLength(2);
    a.send({ type: 'start' });
    expect((await b.until('started')).lobby.course).toBe('silly');

    // Events: the sender gets an ack, everyone else the event, in order.
    a.send({ type: 'event', seq: 0, e: { t: 'hole-start', wind: [1, 2] } });
    expect(await a.until('ack')).toMatchObject({ seq: 0 });
    expect(await b.until('event')).toMatchObject({ seq: 0, from: 'client-aaaa', e: { t: 'hole-start', wind: [1, 2] } });
    b.send({ type: 'event', seq: 1, e: { t: 'throw', player: 1 } });
    expect(await b.until('ack')).toMatchObject({ seq: 1 });
    expect(await a.until('event')).toMatchObject({ seq: 1, from: 'client-bbbb' });

    // Two at once: the second, with a stale seq, is rejected and told what's next.
    a.send({ type: 'event', seq: 2, e: { t: 'mulligan', player: 0 } });
    b.send({ type: 'event', seq: 2, e: { t: 'mulligan', player: 1 } });
    expect(await a.until('ack')).toMatchObject({ seq: 2 });
    expect(await b.until('reject')).toMatchObject({ seq: 2, expected: 3 });

    // A late joiner (or a refresh) gets the lobby, the started flag and the whole log.
    const c = await connect(code, 'client-cccc', 'Cy');
    const wc = await c.until('welcome');
    expect(wc.started).toBe(true);
    expect(wc.lobby.seats.map((s: Msg) => s.name)).toEqual(['Ann', 'Bo']);
    expect(wc.log.map((x: Msg) => [x.seq, x.from, x.e.t])).toEqual([[0, 'client-aaaa', 'hole-start'], [1, 'client-bbbb', 'throw'], [2, 'client-aaaa', 'mulligan']]);

    // The lobby is frozen once started.
    a.send({ type: 'lobby', lobby: lobby([]) });
    expect((await a.until('error')).reason).toMatch(/started/);
    for (const x of [a, b, c]) x.close();
  });

  it('the host ends the game: everyone is back in the same lobby, and the next game starts clean', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    const b = await connect(code, 'client-bbbb', 'Bo');
    await b.until('welcome');
    const seats = [{ name: 'Ann', client: 'client-aaaa' }, { name: 'Bo', client: 'client-bbbb' }];
    a.send({ type: 'lobby', lobby: lobby(seats) });
    a.send({ type: 'start' });
    await b.until('started');
    a.send({ type: 'event', seq: 0, e: { t: 'hole-start', wind: [1, 0] } });
    await a.until('ack');
    await b.until('event');

    // Only the host can end it.
    b.send({ type: 'end' });
    expect((await b.until('error')).reason).toMatch(/host/);
    a.send({ type: 'end' });
    const ended = await b.until('ended');
    expect(ended.lobby.seats).toEqual(seats);
    await a.until('ended');

    // A browser coming back (a reload) sees the lobby, not the old game.
    b.close();
    const b2 = await connect(code, 'client-bbbb', 'Bo');
    const w = await b2.until('welcome');
    expect(w.started).toBe(false);
    expect(w.log).toEqual([]);
    expect(w.lobby.seats).toEqual(seats);

    // The next game: a new setup, and the log starts again at 0.
    a.send({ type: 'lobby', lobby: { ...lobby(seats), course: 'range', count: 1 } });
    expect((await b2.until('lobby')).lobby.course).toBe('range');
    a.send({ type: 'start' });
    await b2.until('started');
    b2.send({ type: 'event', seq: 0, e: { t: 'hole-start', wind: [0, 0] } });
    expect((await b2.until('ack')).seq).toBe(0);
    a.close(); b2.close();
  });

  it('the room survives everyone leaving: rejoining gets the same log', async () => {
    const code = room();
    const a = await connect(code, 'client-dddd', 'Di');
    await a.until('welcome');
    a.send({ type: 'lobby', lobby: lobby([{ name: 'Di', client: 'client-dddd' }]) });
    await a.until('lobby');
    a.send({ type: 'start' });
    await a.until('started');
    for (let k = 0; k < 5; k++) { a.send({ type: 'event', seq: k, e: { t: 'throw', k } }); await a.until('ack'); }
    a.close();
    await new Promise((r) => setTimeout(r, 300));
    const again = await connect(code, 'client-dddd', 'Di');
    const w = await again.until('welcome');
    expect(w.host).toBe('client-dddd');
    expect(w.log.map((x: Msg) => x.e.k)).toEqual([0, 1, 2, 3, 4]);
    again.close();
  });

  it('refuses bad room codes and client ids, and non-WebSocket requests', async () => {
    const http = BASE!.replace(/^ws/, 'http');
    expect((await fetch(`${http}/room/ABCDE`)).status).toBe(426);
    expect((await fetch(`${http}/`)).status).toBe(404);
    await expect(connect('ABCDE', 'x', 'bad id')).rejects.toThrow(); // client id too short
    await expect(connect('AB', 'client-eeee', 'Ed')).rejects.toThrow(); // code too short
  });
});
