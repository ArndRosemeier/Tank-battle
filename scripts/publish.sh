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
say "public: 200, the page references $ENTRY_JS and the asset itself answers 200"
say "PUBLISHED: https://apps.futuremagic.de/${SLUG}/"
