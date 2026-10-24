// Online: how the connection to the room is doing, as a dot and the heartbeat's round trip
// (src/net/room.ts pings every 15 s). Green under 120 ms, amber under 300, red above or while
// reconnecting.
export interface NetStatus {
  status(s: 'connecting' | 'open' | 'closed'): void;
  ping(ms: number): void;
}

export function mountNetStatus(el: HTMLElement): NetStatus {
  let ms: number | null = null;
  let state: 'connecting' | 'open' | 'closed' = 'connecting';
  const render = () => {
    el.hidden = false;
    const live = state === 'open';
    const tone = !live ? 'off' : ms === null ? '' : ms < 120 ? 'good' : ms < 300 ? 'ok' : 'bad';
    el.className = `${el.className.split(' ').filter((c) => !['good', 'ok', 'bad', 'off'].includes(c)).join(' ')} ${tone}`.trim();
    el.textContent = !live ? (state === 'connecting' ? 'Connecting…' : 'Reconnecting…') : ms === null ? 'Online' : `${Math.round(ms)} ms`;
    el.title = live ? `Connected to the room${ms === null ? '' : `: ${Math.round(ms)} ms round trip`}` : 'Not connected to the room: reconnecting';
  };
  return {
    status(s) { state = s; if (s !== 'open') ms = null; render(); },
    ping(v) { ms = v; render(); },
  };
}
