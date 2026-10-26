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
async function connect(room: string, client: string, name: string, query = '') {
  const ws = new WebSocket(`${BASE}/room/${room}?client=${client}&name=${encodeURIComponent(name)}${query}`);
  const inbox: Msg[] = [];
  const waiters: ((m: Msg) => void)[] = [];
  ws.addEventListener('message', (ev) => {
    if (ev.data === 'pong') return; // heartbeat answers aren't JSON
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
  const until = async (type: string, timeout?: number) => { for (;;) { const m = await next(timeout); if (m.type === type) return m; } };
  const send = (m: Msg) => ws.send(JSON.stringify(m));
  return { ws, next, until, send, close: () => ws.close() };
}

const room = () => `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const lobby = (seats: { name: string; client: string; color?: string }[]) => ({ course: 'silly', first: 0, count: 9, crazy: false, seats });

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

  it('the lobby carries a layout; a bad one is dropped', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    const b = await connect(code, 'client-bbbb', 'Bo');
    await b.until('welcome');
    const seats = [{ name: 'Ann', client: 'client-aaaa' }, { name: 'Bo', client: 'client-bbbb' }];
    a.send({ type: 'lobby', lobby: { ...lobby(seats), layout: { tees: 'short', pins: 'mixed', seed: 42 } } });
    expect((await b.until('lobby')).lobby.layout).toEqual({ tees: 'short', pins: 'mixed', seed: 42 });
    // A bot's seat (bot-<level>-<n>) is kept like anyone's.
    a.send({ type: 'lobby', lobby: lobby([...seats, { name: 'Bot 1 (Pro)', client: 'bot-pro-1' }]) });
    expect((await b.until('lobby')).lobby.seats.map((q: Msg) => q.client)).toContain('bot-pro-1');
    a.send({ type: 'lobby', lobby: { ...lobby(seats), layout: { tees: 'tiny', pins: 'A' } } });
    expect((await b.until('lobby')).lobby.layout).toBeUndefined();
    a.close();
    b.close();
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

  it('members carry a color: from the link, then changed with a color message; bad ones refused', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    // connect() has no color parameter: join with one by hand.
    const ws = new WebSocket(`${BASE}/room/${code}?client=client-cccc&name=Cy&color=%23ff9a3c`);
    await new Promise<void>((res) => ws.addEventListener('open', () => res()));
    const m1 = await a.until('members');
    expect(m1.members.find((m: Msg) => m.client === 'client-cccc').color).toBe('#ff9a3c');
    a.send({ type: 'color', color: '#2ed3c0' });
    const m2 = await a.until('members');
    expect(m2.members.find((m: Msg) => m.client === 'client-aaaa').color).toBe('#2ed3c0');
    a.send({ type: 'color', color: 'red; background:url(x)' });
    expect((await a.until('error')).reason).toMatch(/bad color/);
    // Seats keep a valid color and drop a bad one.
    a.send({ type: 'lobby', lobby: lobby([{ name: 'Ann', client: 'client-aaaa', color: '#2ed3c0' }, { name: 'Cy', client: 'client-cccc', color: 'javascript:' }]) });
    const l = (await a.until('lobby')).lobby;
    expect(l.seats[0].color).toBe('#2ed3c0');
    expect(l.seats[1].color).toBeUndefined();
    ws.close(); a.close();
  });

  it('members carry a disc design: from the link, then a design message; seats keep good ones', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    const ws = new WebSocket(`${BASE}/room/${code}?client=client-cccc&name=Cy&design=galaxy`);
    await new Promise<void>((res) => ws.addEventListener('open', () => res()));
    expect((await a.until('members')).members.find((m: Msg) => m.client === 'client-cccc').design).toBe('galaxy');
    a.send({ type: 'design', design: 'flame' });
    expect((await a.until('members')).members.find((m: Msg) => m.client === 'client-aaaa').design).toBe('flame');
    a.send({ type: 'design', design: '<img>' });
    expect((await a.until('error')).reason).toMatch(/bad design/);
    a.send({ type: 'lobby', lobby: lobby([{ name: 'Ann', client: 'client-aaaa', design: 'flame' } as never, { name: 'Cy', client: 'client-cccc', design: 'x y' } as never]) });
    const l = (await a.until('lobby')).lobby;
    expect(l.seats[0].design).toBe('flame');
    expect(l.seats[1].design).toBeUndefined();
    ws.close(); a.close();
  });

  it("the daily board: a player's first score counts, others are practice; far-off days refused", async () => {
    const http = BASE!.replace(/^ws/, 'http');
    // A fresh board: a day the other runs haven't used (yesterday's or tomorrow's would clash too).
    const day = new Date().toISOString().slice(0, 10);
    const who = `client-${Math.random().toString(36).slice(2, 10)}`;
    const post = (strokes: number, toPar: number) => fetch(`${http}/daily/${day}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: who, name: 'Ann', strokes, toPar }) });
    const first = await post(10, 1);
    expect(first.headers.get('access-control-allow-origin')).toBe('*');
    const b1 = await first.json();
    expect(b1.you).toMatchObject({ strokes: 10, toPar: 1 });
    const b2 = await (await post(8, -1)).json(); // a better practice round doesn't replace it
    expect(b2.you).toMatchObject({ strokes: 10, toPar: 1 });
    const got = await (await fetch(`${http}/daily/${day}?client=${who}`)).json();
    expect(got.players).toBeGreaterThanOrEqual(1);
    expect(got.top.some((r: Msg) => r.you && r.name === 'Ann')).toBe(true);
    expect((await fetch(`${http}/daily/2001-01-01`)).status).toBe(400);
    expect((await fetch(`${http}/daily/${day}`, { method: 'POST', body: JSON.stringify({ client: who, name: 'x', strokes: -3, toPar: 0 }) })).status).toBe(400);
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

  it('a reconnect to the same game gets only the events it is missing; another game gets all of them', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    const w0 = await a.until('welcome');
    expect(w0.protocol).toBe(2);
    a.send({ type: 'lobby', lobby: lobby([{ name: 'Ann', client: 'client-aaaa' }]) });
    a.send({ type: 'start' });
    const { game } = await a.until('started');
    expect(game).toMatch(/\w+/);
    for (let k = 0; k < 4; k++) { a.send({ type: 'event', seq: k, e: { t: 'throw', k } }); await a.until('ack'); }
    a.close();
    const b = await connect(code, 'client-aaaa', 'Ann', `&game=${game}&since=3`);
    const w = await b.until('welcome');
    expect([w.game, w.count, w.since]).toEqual([game, 4, 3]);
    expect(w.log.map((x: Msg) => x.seq)).toEqual([3]);
    b.close();
    const c = await connect(code, 'client-aaaa', 'Ann', '&game=nope&since=3');
    const wc = await c.until('welcome');
    expect([wc.since, wc.log.length]).toEqual([0, 4]);
    c.close();
  });

  it('ping gets pong; ready flags travel with members and clear at the start', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    const pong = new Promise<string>((res) => a.ws.addEventListener('message', (ev) => { if (ev.data === 'pong') res(String(ev.data)); }));
    a.ws.send('ping');
    expect(await pong).toBe('pong');
    a.send({ type: 'ready', ready: true });
    expect((await a.until('members')).members[0].ready).toBe(true);
    a.send({ type: 'lobby', lobby: lobby([{ name: 'Ann', client: 'client-aaaa' }]) });
    a.send({ type: 'start' });
    await a.until('started');
    a.close();
    const again = await connect(code, 'client-aaaa', 'Ann');
    expect((await again.until('welcome')).members[0].ready).toBeFalsy();
    again.close();
  });

  it('a host who leaves for good hands the room to the first seated player still here', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    const b = await connect(code, 'client-bbbb', 'Bo');
    await b.until('welcome');
    const c = await connect(code, 'client-cccc', 'Cy');
    await c.until('welcome');
    a.send({ type: 'lobby', lobby: lobby([{ name: 'Ann', client: 'client-aaaa' }, { name: 'Cy', client: 'client-cccc' }, { name: 'Bo', client: 'client-bbbb' }]) });
    await c.until('lobby');
    a.close();
    expect((await c.until('host', 15000)).host).toBe('client-cccc');
    // The new host can do the host's jobs.
    c.send({ type: 'start' });
    expect((await b.until('started')).lobby.seats).toHaveLength(3);
    b.close(); c.close();
  }, 20000);

  it('the lobby keeps best-shot teams (one per seat, two or more teams), and drops anything else', async () => {
    const code = room();
    const a = await connect(code, 'client-aaaa', 'Ann');
    await a.until('welcome');
    const three = [{ name: 'Ann', client: 'client-aaaa' }, { name: 'Bo', client: 'client-bbbb' }, { name: 'Cy', client: 'client-cccc' }];
    a.send({ type: 'lobby', lobby: { ...lobby(three), teams: [1, 0, 1] } }); // 1 v 2
    expect((await a.until('lobby')).lobby.teams).toEqual([1, 0, 1]);
    for (const bad of [[0, 0, 0], [0, 1], [0, 9, 1], 3]) {
      a.send({ type: 'lobby', lobby: { ...lobby(three), teams: bad } });
      expect((await a.until('lobby')).lobby.teams).toBeUndefined();
    }
    a.close();
  });

  it('refuses bad room codes and client ids, and non-WebSocket requests', async () => {
    const http = BASE!.replace(/^ws/, 'http');
    expect((await fetch(`${http}/room/ABCDE`)).status).toBe(426);
    expect((await fetch(`${http}/`)).status).toBe(404);
    await expect(connect('ABCDE', 'x', 'bad id')).rejects.toThrow(); // client id too short
    await expect(connect('AB', 'client-eeee', 'Ed')).rejects.toThrow(); // code too short
  });
});
