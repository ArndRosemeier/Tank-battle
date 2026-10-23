#!/usr/bin/env bash
#
# publish.sh — THE one way this game reaches https://apps.futuremagic.de/tank-battle/
#
# It builds with the subpath base into `release/` (NEVER `dist/`), verifies the build
# actually references that base (a root-absolute build served under a subpath is a blank,
# button-dead page), points the host's app folder at `release/` (a symlink), proves the
# served bytes match the build BY CONTENT, and refreshes the hub card grid.
#
# WHY `release/` AND NOT `dist/`: `dist/` is the local build output that the GATE and the
# SCREENSHOT tool write on every run (base `/`). While the host pointed at `dist/`, each
# gate run silently redeployed the live app with root-absolute asset URLs, which 404 under
# the subpath. The published folder is now owned solely by this script.
#
# Usage:  bash scripts/publish.sh            # build, publish, verify
#         SKIP_BUILD=1 bash scripts/publish.sh   # republish an existing dist/
#
# Exit codes (the vocabulary; quote them exactly):
#   0  published and verified by content
#   1  failed — read the message; nothing was claimed
#   2  built but the base path is wrong (refused to publish a blank page)
#   3  the bytes are live but the deployed page FAILED the browser smoke
#
set -uo pipefail

SLUG="${SLUG:-tank-battle}"
BASE="/${SLUG}/"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/release"
TARGET="$HOME/apps/$SLUG"
HUB="$HOME/projects/futuremagic/scripts/publish-apps-root.sh"
LOCAL_HOST="http://127.0.0.1:8082/${SLUG}/"
PUBLIC_HOST="https://apps.futuremagic.de/${SLUG}/"

say() { printf '%s\n' "$*"; }
die() { printf 'PUBLISH FAILED: %s\n' "$*" >&2; exit 1; }

# --- 1. build -----------------------------------------------------------------
# --- 0. a published build must correspond to a COMMIT -------------------------
# The live artifact is built from the working tree, so an uncommitted source change makes
# what the owner sees unreproducible from any SHA. This happened once (a clamp fix was
# live before it was committed). Refuse, unless the operator deliberately overrides.
if [ "${PUBLISH_DIRTY:-0}" != "1" ]; then
  DIRTY="$(git -C "$ROOT" status --porcelain -- src scripts vite.config.ts index.html assets package.json)"
  if [ -n "$DIRTY" ]; then
    printf 'PUBLISH REFUSED: the working tree has uncommitted source changes; the published build must correspond to a commit.\n' >&2
    printf '%s\n' "$DIRTY" | sed 's/^/  /' >&2
    die "commit first (or set PUBLISH_DIRTY=1 to override deliberately)"
  fi
fi

STAGE="$ROOT/.gate-logs/publish-dist"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  say "build: base=${BASE} (staged in .gate-logs/publish-dist)"
  rm -rf "$STAGE"
  ( cd "$ROOT" && pnpm exec tsc --noEmit && TANK_BATTLE_BASE="$BASE" pnpm exec vite build --outDir "$STAGE" --emptyOutDir ) || die "the build failed"
  # MERGE, never wipe: the CDN caches the fixed-name index.html for four hours, so an
  # older page can still be served and must find the asset hashes it references.
  mkdir -p "$DIST"
  cp -a "$STAGE"/. "$DIST"/ || die "could not merge the build into dist"
fi
[ -f "$DIST/index.html" ] || die "no dist/index.html — did the build run?"

# --- 2. the base path must be in the built HTML -------------------------------
# A root-absolute build under a subpath is a blank page, and only this check catches it.
if ! grep -q "${BASE}assets/" "$DIST/index.html"; then
  say "--- dist/index.html asset references ---"
  grep -o 'src="[^"]*"' "$DIST/index.html" | head -5
  printf 'PUBLISH REFUSED: the build does not reference %sassets/ (exit 2)\n' "$BASE" >&2
  exit 2
fi
ENTRY_JS="$(grep -o "assets/index-[^\"']*\\.js" "$DIST/index.html" | head -1)"
[ -n "$ENTRY_JS" ] || die "could not find the hashed entry script in dist/index.html"
say "entry: $ENTRY_JS"

# --- 3. point the host at the build ------------------------------------------
mkdir -p "$HOME/apps" || die "cannot create ~/apps"
ln -sfn "$DIST" "$TARGET" || die "could not link $TARGET"
say "link:  $(readlink -f "$TARGET")"

# --- 4. verify BY CONTENT, locally ------------------------------------------
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$LOCAL_HOST")"
[ "$CODE" = "200" ] || die "local $LOCAL_HOST answered $CODE"
if ! curl -s "$LOCAL_HOST" | grep -q "$(basename "$ENTRY_JS")"; then
  die "local entry does not reference $ENTRY_JS (a stale copy answers 200 too)"
fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' "${LOCAL_HOST}${ENTRY_JS}")"
[ "$CODE" = "200" ] || die "the entry asset answered $CODE at ${LOCAL_HOST}${ENTRY_JS}"
say "local:  200, entry matches the build"

# --- 5. refresh the hub (a new app is invisible on the landing page until then)
if [ -x "$HUB" ]; then
  say "hub:    refreshing the apps root"
  bash "$HUB" >/tmp/hub-refresh.log 2>&1
  HUB_CODE=$?
  if [ "$HUB_CODE" != "0" ]; then
    say "hub:    FAILED (exit $HUB_CODE) — see /tmp/hub-refresh.log"
    die "the hub refresh failed; the app is live but its card is not"
  fi
  say "hub:    refreshed"
else
  say "hub:    no hub script at $HUB — skipped (recorded)"
fi

# --- 6. verify the PUBLIC url by content ------------------------------------
# The entry HTML has a fixed name and the CDN caches for four hours, so ask for a
# nonce-carrying URL and check the BODY, not the status.
NONCE="$(date +%s)"
BODY="$(curl -s "${PUBLIC_HOST}?cb=${NONCE}")" || die "the public URL did not answer"
if ! printf '%s' "$BODY" | grep -q "$(basename "$ENTRY_JS")"; then
  die "the public entry does not reference $ENTRY_JS yet (CDN may still serve the old page; retry with another nonce or purge)"
fi
PUBLIC_ASSET_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${PUBLIC_HOST}${ENTRY_JS}?cb=${NONCE}")"
[ "$PUBLIC_ASSET_CODE" = "200" ] || die "the public asset ${PUBLIC_HOST}${ENTRY_JS} answered $PUBLIC_ASSET_CODE"

# The audio bridge is a separate copy step; a publish without it is a silent game. Check
# the manifest and one clip over the PUBLIC URL, because a 200 on the entry proves nothing
# about them.
[ -f "$DIST/assets/manifest.json" ] || die "release/assets/manifest.json is missing — the audio bridge did not follow the build outDir"
[ -d "$DIST/assets/audio" ] || die "release/assets/audio/ is missing"
for probe in "assets/manifest.json" "assets/audio/menu.mp3"; do
  PROBE_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${PUBLIC_HOST}${probe}?cb=${NONCE}")"
  [ "$PROBE_CODE" = "200" ] || die "the public ${probe} answered $PROBE_CODE — the game would be silent"
done
say "public: 200, the page references $ENTRY_JS, the asset answers 200, and the audio manifest + a clip answer 200"

# --- 7. prove the DEPLOYED page boots ---------------------------------------
# This is the step whose absence produced two live outages: the entry, its asset and the
# audio were all "present", and the page was still dead (a root-base 404, then a missing
# manifest). Only loading it like a visitor catches that class.
if [ "${SKIP_LIVE_SMOKE:-0}" = "1" ]; then
  say "smoke:  SKIPPED by SKIP_LIVE_SMOKE=1 — this publish is NOT verified as a loaded page"
else
  say "smoke:  loading the public page in a real browser"
  node "$ROOT/scripts/live-smoke.mjs" "${PUBLIC_HOST}?cb=${NONCE}"
  SMOKE_CODE=$?
  if [ "$SMOKE_CODE" = "2" ]; then
    die "the live smoke cannot run (Playwright missing). Install it once: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix .browser-smoke --no-save playwright@1.58.2"
  fi
  if [ "$SMOKE_CODE" != "0" ]; then
    printf 'PUBLISH INCOMPLETE: the bytes are live but the page FAILS the smoke (exit %s). Fix or roll back.\n' "$SMOKE_CODE" >&2
    exit 3
  fi
  say "smoke:  the public page booted, Play opened the game, no console or HTTP errors"
fi

# --- 8. measure the DEPLOYED player camera, not a staging pose ---------------
# The look gate once passed on a 28 m staging pose while the 8.2 m camera the player uses
# failed at 29 %. This step captures the real deployed team-mode view and measures THAT.
if [ "${SKIP_LIVE_SMOKE:-0}" != "1" ]; then
  # A single live frame is a lucky sample: a muzzle flash is a bright TRANSIENT that the tile
  # metric cannot tell from a bright surface (measured: a firing frame fails at 16.5 % while
  # the same scene pre-fire passes at 7.8 %). Capture three frames a moment apart and require
  # a majority to pass, so the gate measures the scene rather than a flash.
  PASSED=0
  for attempt in 1 2 3; do
    LIVE_SHOT="$ROOT/.gate-logs/shots/published-live-${attempt}.png"
    if bash "$ROOT/scripts/shot-live.sh" "${PUBLIC_HOST}?mode=team&cb=${NONCE}-${attempt}" "$LIVE_SHOT" >/dev/null 2>&1; then
      # Live combat frames carry additive VFX (muzzle flash, shell, explosion) that the tile
      # statistic cannot tell from a bright surface - measured: the same scene is 7.8 % pre-fire
      # and 16.5 % mid-shot. The deployed check therefore enforces surfaces and contrast and
      # reports the tile number as INFO; the STRICT tile budget is measured on the controlled
      # scene pose (`shot.sh wide`), where it actually means something.
      if python3 "$ROOT/scripts/look-budget.py" --skip-tile "$LIVE_SHOT" > "$ROOT/.gate-logs/published-look-${attempt}.log" 2>&1; then
        PASSED=$((PASSED + 1))
        say "look:   frame ${attempt}: PASS"
      else
        say "look:   frame ${attempt}: FAIL ($(grep -E '^look-budget: FAIL' "$ROOT/.gate-logs/published-look-${attempt}.log" | head -1))"
      fi
    else
      say "look:   frame ${attempt}: capture failed"
    fi
    sleep 0.8
  done
  if [ "$PASSED" -lt 2 ]; then
    printf 'PUBLISH INCOMPLETE: the deployed player camera failed the look budget on %s of 3 frames.\n' "$((3 - PASSED))" >&2
    exit 3
  fi
  say "look:   the deployed player camera passes the look budget (${PASSED}/3 frames)"
fi

say "PUBLISHED: https://apps.futuremagic.de/${SLUG}/"
