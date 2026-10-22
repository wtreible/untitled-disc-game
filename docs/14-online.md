# Online play

Friends play together from their own browsers: one hosts a room, the others open its link (or type its code). Hosting or joining asks for your name first (nothing connects until you give one). Everyone in the room gets a player, up to 6. More can join and watch. Hot seat still works, and can be mixed in later (one browser controlling several players).

## How it works

- **The round is an event log** (`src/modes/discRound.ts`, D52). Everything players share changes only through JSON events: hole start (carrying its wind), throw (carrying its computed flight), mulligan, Crazy mode offer, pick, reroll and placement, and `next` (the host closes a scorecard). Replaying the log rebuilds the round exactly.
- **The thrower's browser simulates the throw** and sends the whole flight. Others replay it rather than re-simulating, so small floating-point differences between browsers can't make a throw land elsewhere.
- **The round says what's next** (`DiscRound.stage`): drafting, need-hole, placing, playing or card. Each browser acts if it's one of its players (or the host, for starting a hole and continuing past a scorecard) and otherwise waits, showing who it's waiting for. Joining mid-game is the same: replay the log, then ask what's next.
- **A room** (`server/src/index.ts`) is a Cloudflare Durable Object. It holds the lobby (host, course, holes, Crazy mode, which browser controls which player) and the event log in SQLite, and it relays events. It doesn't run the game. Each event names the log position it expects (its `seq`); a stale one is rejected, so two at once can't both land. Turns make that rare. When it happens, the losing browser reloads, rejoins and replays the room's log.
- **Reconnects** get the full log; missed events are applied, and our own events the room didn't get are re-sent. A refresh rejoins as the same person (a client id kept in localStorage).
- **A throw is sent the moment it's released,** so everyone watches it fly at the same time (measured: the watcher's flight starts ~50 ms after release, where it used to wait the thrower's whole flight and replay, ~8 s). Every browser, the thrower's included, applies it when it lands, so the leaderboard doesn't give the result away early. Everyone waits out the same pause after a throw (including the mulligan window) before the next turn.
- **Live aim:** while a player lines up, their browser streams their aim about 10 times a second, only when something changes: direction, target, disc, release angle, forehand, and the meter while charging. The room relays it without storing it. Watchers see their aim line and target, the disc picker on their disc, their release angle and their meter. In first person you look where they look. A 20-second aim costs about 10 billed requests (incoming messages bill at 20:1), so a 4-player 18-hole round is a few thousand of the free plan's 100,000 a day.
- **Names:** your name can be changed in the lobby until the start (a `name` message; the server updates everyone's member list and the host's lobby picks it up). Repeated names get a 2-digit number ("Sam", "Sam 47"), taken from the browser's client id so it doesn't change as people come and go (`uniqueNames`, also used in hot seat).
- **Seats:** the host first, then seats in the order people joined; a newcomer never bumps an earlier player to watching. A seated player who drops keeps their seat for a minute in the lobby.
- **Away players:** when the round waits on someone who has disconnected (their throw, draft pick or placement), the host gets **Play for them** after 4 s. The host then controls that player until they reconnect, when control goes straight back.
- **Following throws:** a friend's throw is ridden along live with the chase camera at replay pace, with no replay after (Settings → Follow friends' throws). The leaderboard's **Up next** strip shows the away-rule order as it stands.
- **The game clock travels with each throw.** Moving props (windmill blades, the drawbridge, the sweeping ring) are simulated at the thrower's clock; the throw event carries it, and every browser takes it when the throw flies, so the props on screen are where the physics had them.
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

- One player per browser online (no hot seat inside a room yet).
- Renaming in the lobby, 6 seats and bag building in the lobby need the room server from 2026-10-21 (evening) or later (`npm run server:deploy`).
- If the host drops mid-game, nobody else can play for an away player.
- Live aim needs the room server from 2026-10-21 or later (`npm run server:deploy`). An older server refuses those messages, and the game ignores the refusal, so it still plays without live aim.
