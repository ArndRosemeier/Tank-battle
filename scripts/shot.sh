#!/usr/bin/env bash
#
# shot.sh — THE one screenshot command for Tank Battle.
#
#   bash scripts/shot.sh [pose] [detail] [output.png]
#   pose:   wide | tank | first | combat | top | spectate (default wide)
#   detail: 0 … 1                        (default 0.3, the SURFACE_DETAIL default)
#   output: default .gate-logs/shots/<pose>-detail-<detail>.png
#
# It builds the app, serves `dist` on 127.0.0.1, runs headless Chrome at 1920×1080
# with a virtual-time budget, then kills the server AND the whole Chrome process
# tree — in a `trap`, on success and on failure alike. Chrome is a process TREE, not
# a process: killing the launcher leaves the zygote/GPU/renderer children behind, so
# it is started in its own session (`setsid`) and its process group is signalled.
#
# The listed flags use `--disable-gpu`. If that produces no usable WebGL frame (a
# tiny/black PNG), the script retries ONCE with SwiftShader and says which mode
# worked. A screenshot that did not render is a failure, never a deliverable.
#
# Verification line: `ps -eo comm= | grep -c '^chrome$'` is expected to print 0.
# It counts by EXECUTABLE NAME, so it cannot self-match this shell the way a
# `pgrep -f` pattern in the script's own argv would.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

POSE="${1:-wide}"
DETAIL="${2:-0.3}"
OUT="${3:-.gate-logs/shots/${POSE}-detail-${DETAIL}.png}"

CHROME_BIN="${CHROME_BIN:-/usr/bin/google-chrome}"
PORT="${SHOT_PORT:-4183}"
LOG_DIR="$ROOT/.gate-logs"
OUT_ABS="$OUT"
case "$OUT_ABS" in
  /*) ;;
  *) OUT_ABS="$ROOT/$OUT_ABS" ;;
esac

case "$POSE" in
  wide | tank | first | combat | top | spectate) ;;
  *)
    echo "shot: unknown pose '$POSE' — expected wide, tank, first, combat, top or spectate" >&2
    exit 2
    ;;
esac
if ! [[ "$DETAIL" =~ ^(0(\.[0-9]+)?|1(\.0+)?)$ ]]; then
  echo "shot: detail must be a number within 0…1, got '$DETAIL'" >&2
  exit 2
fi
if [ ! -x "$CHROME_BIN" ]; then
  echo "shot: Chrome is not executable at $CHROME_BIN" >&2
  exit 2
fi

mkdir -p "$LOG_DIR" "$(dirname "$OUT_ABS")"
SERVER_LOG="$LOG_DIR/shot-server.log"
CHROME_LOG="$LOG_DIR/shot-chrome.log"
PROFILE_DIR="$(mktemp -d "$LOG_DIR/chrome-profile.XXXXXX")"

SERVER_PID=""
CHROME_PID=""
RENDER_MODE=""
FAILED=0

cleanup() {
  set +e
  trap - EXIT INT TERM

  if [ -n "$CHROME_PID" ] && kill -0 "$CHROME_PID" 2>/dev/null; then
    kill -TERM -- "-$CHROME_PID" 2>/dev/null
    for _ in $(seq 1 30); do
      kill -0 "$CHROME_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$CHROME_PID" 2>/dev/null
  fi
  CHROME_PID=""

  if [ -n "$SERVER_PID" ]; then
    kill -TERM "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=""

  rm -rf "$PROFILE_DIR"

  local chrome_count
  chrome_count="$(ps -eo comm= | grep -c '^chrome$' || true)"
  echo ""
  echo "screenshot: $OUT_ABS"
  if [ -f "$OUT_ABS" ]; then
    echo "size:       $(wc -c < "$OUT_ABS") bytes"
  else
    echo "size:       MISSING"
  fi
  echo "render:     ${RENDER_MODE:-none}"
  echo "chrome processes after cleanup: $chrome_count (expected 0)"
  if [ "$chrome_count" != "0" ]; then
    echo "shot: ERROR — Chrome processes outlived the run; the tree was NOT reaped" >&2
    exit 1
  fi
  if [ "$FAILED" != "0" ]; then
    exit 1
  fi
  exit 0
}
trap cleanup EXIT INT TERM

echo "shot: building"
pnpm build

echo "shot: serving $ROOT/dist on 127.0.0.1:$PORT"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT/dist" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

server_ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "shot: the static server died — see $SERVER_LOG" >&2
    FAILED=1
    exit 1
  fi
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null; then
    server_ready=1
    break
  fi
  sleep 0.1
done
if [ "$server_ready" != "1" ]; then
  echo "shot: the static server never answered on port $PORT — see $SERVER_LOG" >&2
  FAILED=1
  exit 1
fi

DEMO_QUERY=""
if [ "$POSE" = "combat" ]; then
  DEMO_QUERY="&demo=duel&ticks=122"
elif [ "$POSE" = "spectate" ]; then
  DEMO_QUERY="&mode=spectate&teams=4&tanksPerTeam=4&seed=7&ticks=${SPECTATE_TICKS:-300}"
fi
URL="http://127.0.0.1:$PORT/?pose=$POSE&detail=$DETAIL$DEMO_QUERY"
BASE_ARGS=(
  --headless=new
  --disable-gpu
  --no-sandbox
  --hide-scrollbars
  --disable-dev-shm-usage
  --no-first-run
  --no-default-browser-check
  --user-data-dir="$PROFILE_DIR"
  --window-size=1920,1080
  --virtual-time-budget=10000
  --screenshot="$OUT_ABS"
)

# A rendered frame at 1920×1080 is hundreds of KB; a black page is a few KB. This is
# a smoke test for "WebGL produced pixels", not a judgement of the look: the measured
# look budget below is the gate, and a FAIL makes this command exit non-zero.
screenshot_usable() {
  [ -f "$OUT_ABS" ] && [ "$(wc -c < "$OUT_ABS")" -ge 30000 ]
}

run_chrome() {
  local label="$1"
  shift
  echo "shot: Chrome attempt — $label"
  rm -f "$OUT_ABS"
  setsid "$CHROME_BIN" "${BASE_ARGS[@]}" "$@" "$URL" >"$CHROME_LOG" 2>&1 &
  CHROME_PID=$!
  local status=0
  wait "$CHROME_PID" || status=$?
  # The launcher can exit while children still hold the page; reap the group now so
  # the next attempt starts clean and the final count is meaningful.
  kill -TERM -- "-$CHROME_PID" 2>/dev/null || true
  CHROME_PID=""
  sleep 0.3
  if [ "$status" != "0" ]; then
    echo "shot: Chrome exited $status — see $CHROME_LOG" >&2
  fi
}

run_chrome "listed flags (--disable-gpu)" || true
if screenshot_usable; then
  RENDER_MODE="listed flags (--disable-gpu)"
else
  echo "shot: the first frame is missing or too small to be a rendered scene."
  echo "shot: retrying with SwiftShader (--enable-unsafe-swiftshader --use-angle=swiftshader)."
  run_chrome "SwiftShader fallback" --enable-unsafe-swiftshader --use-angle=swiftshader || true
  if screenshot_usable; then
    RENDER_MODE="SwiftShader fallback (--enable-unsafe-swiftshader --use-angle=swiftshader)"
  fi
fi

if ! screenshot_usable; then
  echo "shot: ERROR — no usable WebGL screenshot was produced." >&2
  echo "shot: The app reports its failure in the #error banner; read $CHROME_LOG and the PNG." >&2
  FAILED=1
  exit 1
fi

echo "shot: measuring the look budget"
if ! python3 "$ROOT/scripts/look-budget.py" "$OUT_ABS"; then
  echo "shot: look-budget FAILED — this frame is not a deliverable." >&2
  FAILED=1
  exit 1
fi

echo "shot: rendered with $RENDER_MODE"
