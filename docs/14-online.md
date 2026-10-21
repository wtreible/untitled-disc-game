# Online play

Friends play together from their own browsers: one hosts a room, the others open its link (or type its code). Everyone in the room gets a player, up to 4. More can join and watch. Hot seat still works, and can be mixed in later (one browser controlling several players).

## How it works

- **The round is an event log** (`src/modes/discRound.ts`, D52). Everything players share changes only through JSON events: hole start (carrying its wind), throw (carrying its computed flight), mulligan, Crazy mode offer, pick, reroll and placement, and `next` (the host closes a scorecard). Replaying the log rebuilds the round exactly.
- **The thrower's browser simulates the throw** and sends the whole flight. Others replay it rather than re-simulating, so small floating-point differences between browsers can't make a throw land elsewhere.
- **The round says what's next** (`DiscRound.stage`): drafting, need-hole, placing, playing or card. Each browser acts if it's one of its players (or the host, for starting a hole and continuing past a scorecard) and otherwise waits, showing who it's waiting for. Joining mid-game is the same: replay the log, then ask what's next.
- **A room** (`server/src/index.ts`) is a Cloudflare Durable Object. It holds the lobby (host, course, holes, Crazy mode, which browser controls which player) and the event log in SQLite, and it relays events. It doesn't run the game. Each event names the log position it expects (its `seq`); a stale one is rejected, so two at once can't both land. Turns make that rare. When it happens, the losing browser reloads, rejoins and replays the room's log.
- **Reconnects** get the full log; missed events are applied, and our own events the room didn't get are re-sent. A refresh rejoins as the same person (a client id kept in localStorage).
- **A throw is committed when it lands,** so friends see it fly, then the leaderboard updates. Everyone waits out the same pause after a throw (including the mulligan window) before the next turn.
- **Rooms delete themselves** after a week idle.

## Free tier

The room service runs on Cloudflare's Workers Free plan (Durable Objects with the SQLite backend). A 4-player, 18-hole round is roughly 30 billed requests, ~500 rows written and ~3 MB stored, against daily limits of 100,000 requests and 100,000 rows written, and 5 GB storage in total. WebSocket hibernation means idle rooms aren't billed for duration. Over a limit, requests fail until 00:00 UTC; nothing is charged.

## Running and deploying

| | |
|---|---|
| Local room server | `npm run server:dev` (Cloudflare's runtime, on ws://127.0.0.1:8787; dev builds of the game use it automatically) |
| Protocol tests | `ROOMS_URL=ws://127.0.0.1:8787 npx vitest run tests/rooms.server.test.ts` |
| Deploy the server | `npx wrangler login` once, then `npm run server:deploy`; it prints `https://untitled-disc-game-rooms.<you>.workers.dev` |
| Point the site at it | GitHub repo → Settings → Secrets and variables → Actions → Variables: `ROOMS_URL` = `wss://untitled-disc-game-rooms.<you>.workers.dev`, then re-run the Pages deploy |

Without `ROOMS_URL`, public builds hide "Play online".

## Not yet

- Your name in a room is the one in the first name box when you join; to change it, leave and rejoin.
- One player per browser online (no hot seat inside a room yet).
- Watching shows the other player's position and their throw, not their aiming.
