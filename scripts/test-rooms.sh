#!/usr/bin/env bash
# Room server protocol tests (tests/rooms.server.test.ts) against a local `wrangler dev`, started
# here and stopped after. Used by CI too: npm run test:rooms
set -euo pipefail
PORT=${PORT:-8787}
LOG=$(mktemp)
# Its own process group, so stopping it stops workerd too (npx doesn't pass the signal on).
setsid npx wrangler dev --config server/wrangler.toml --port "$PORT" >"$LOG" 2>&1 &
PID=$!
trap 'kill -- -$PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  if ! kill -0 $PID 2>/dev/null; then cat "$LOG"; echo "wrangler dev exited" >&2; exit 1; fi
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:$PORT/" || { cat "$LOG"; echo "wrangler dev didn't start" >&2; exit 1; }
ROOMS_URL="ws://127.0.0.1:$PORT" npx vitest run tests/rooms.server.test.ts || { echo '--- wrangler dev log ---'; cat "$LOG"; exit 1; }
