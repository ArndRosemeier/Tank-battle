#!/usr/bin/env bash
#
# shot-live.sh — screenshot the PUBLISHED app (not the local build), with no leftovers.
#
#   bash scripts/shot-live.sh [url] [output.png]
#
# Why this exists separately from shot.sh: publish verification needs the real public
# URL, and the first attempt at this leaked 14 Chrome processes because `setsid ... &`
# does not hand back the process group you think it does. So this script:
#   1. gives Chrome a UNIQUE profile directory (random, per run),
#   2. waits for the launcher, then CAPTURES every PID whose command line names that
#      profile dir into a file,
#   3. kills that file (TERM, then KILL), which cannot self-match this shell because the
#      directory name is generated at runtime and is not part of this script's argv,
#   4. verifies with a count that cannot self-match.
#
# Exit: 0 = a frame was captured and no Chrome is left; 1 = otherwise.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:-https://apps.futuremagic.de/tank-battle/}"
OUT="${2:-$ROOT/.gate-logs/shots/live.png}"
CHROME=/usr/bin/google-chrome
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac
mkdir -p "$(dirname "$OUT")"

PROFILE_DIR="$ROOT/.gate-logs/chrome-live-$$-$RANDOM"
PID_FILE="$ROOT/.gate-logs/chrome-live-pids-$$.txt"
mkdir -p "$PROFILE_DIR"

chrome_count() { ps -eo comm= | grep -cx '^chrome$' || true; }

reap() {
  # Capture by the UNIQUE profile dir, then kill from the file — never a pattern in
  # this shell's own argv.
  ps -eo pid=,args= | grep -F -- "--user-data-dir=$PROFILE_DIR" | awk '{print $1}' > "$PID_FILE" || true
  if [ -s "$PID_FILE" ]; then
    xargs -r kill -TERM < "$PID_FILE" 2>/dev/null || true
    sleep 1
    ps -eo pid=,args= | grep -F -- "--user-data-dir=$PROFILE_DIR" | awk '{print $1}' > "$PID_FILE" || true
    [ -s "$PID_FILE" ] && xargs -r kill -KILL < "$PID_FILE" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  rm -rf "$PROFILE_DIR"
}
trap reap EXIT INT TERM

rm -f "$OUT"
setsid "$CHROME" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$PROFILE_DIR" \
  --window-size=1920,1080 --virtual-time-budget=15000 \
  --screenshot="$OUT" "$URL" >"$ROOT/.gate-logs/shot-live.log" 2>&1 &
CHROME_PID=$!
wait "$CHROME_PID" || true

SIZE=0
[ -f "$OUT" ] && SIZE="$(wc -c < "$OUT")"
reap
trap - EXIT INT TERM
LEFT="$(chrome_count)"
echo "shot-live: url=$URL"
echo "shot-live: file=$OUT bytes=$SIZE"
echo "shot-live: chrome processes after cleanup: $LEFT (expected 0)"
[ "$SIZE" -ge 30000 ] || { echo "shot-live: FAILED — the frame is missing or too small" >&2; exit 1; }
[ "$LEFT" = "0" ] || { echo "shot-live: FAILED — Chrome survivors" >&2; exit 1; }
exit 0
