// The daily challenge's board on the room server (server/src/index.ts /daily/<date>).
import { ROOMS_URL } from './room';

export interface Board {
  players: number;
  top: { name: string; strokes: number; toPar: number; you: boolean }[];
  you?: { rank: number; strokes: number; toPar: number };
}

/** The rooms server over HTTP (its address is a WebSocket one). */
const base = () => (ROOMS_URL ? ROOMS_URL.replace(/^ws/, 'http') : null);

/** The day's board (null: no server, or it didn't answer). */
export async function dailyBoard(date: string, client: string): Promise<Board | null> {
  const b = base();
  if (!b) return null;
  try {
    const r = await fetch(`${b}/daily/${date}?client=${encodeURIComponent(client)}`);
    return r.ok ? ((await r.json()) as Board) : null;
  } catch { return null; }
}

/** Put a score on the day's board (only a player's first counts there); the board after. */
export async function postDaily(date: string, s: { client: string; name: string; strokes: number; toPar: number }): Promise<Board | null> {
  const b = base();
  if (!b) return null;
  try {
    const r = await fetch(`${b}/daily/${date}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    return r.ok ? ((await r.json()) as Board) : null;
  } catch { return null; }
}
