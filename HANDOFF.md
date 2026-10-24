# Handoff — Tank Battle

- **by:** Claude Code (cued side, working for Frank Zimmer in his fork `ArturoBandini20/Tank-battle`), 2026-10-24
- **branch / worktree:** `feat/cued-identity` · Windows checkout `C:\Claude\Gastspiele\Tank-battle`
- **last verified:** `62a3f46` · local full gate **GREEN** (`bash scripts/gate.sh` with
  `GATE_CHEAP_CMD="corepack pnpm run build" GATE_FULL_CMD="corepack pnpm test"`: build OK, 185/185 tests) ·
  **VERIFIED-LOCAL** only: run in a browser inside a local cued instance (iframe, real pass) — badge shown, fragment
  stripped, pass survives `?mode=title`, a malformed pass reaches the error surface. **Not deployed**: the live site
  still serves `main`.
- **live:** `https://apps.futuremagic.de/tank-battle/` (unchanged by this branch)

## Done since the previous handoff

- **cued identity slice** (see `CUED.md`, the integration contract). cued.de (Frank's friends' portal) lists Tank
  Battle as a *guest game*: it runs on this server, inside a sandboxed iframe, and cued appends a signed pass
  `#cued=<JWT HS256>` to the URL.
  - `src/cued/identity.ts` — the ONE pure reader (schema-checked claims, `CuedPassError`, expiry, fragment helpers).
    The browser never verifies the signature; the key must not ship.
  - `src/entry/cued.ts` — reads the pass once, strips it from the address bar, keeps it in sessionStorage (the game's
    own `location.assign('?mode=…')` navigations drop fragments); title badge "CUED · <NAME>" with the avatar circle.
  - `src/main.ts` startup wiring; `index.html` badge element + styles; seam row in `docs/ARCHITECTURE.md`.
  - COPIES: 1 — checked, no duplication (grepped: location.hash, sessionStorage, atob, JWT).
- Note: `src/render/purity.test.ts` also scans tests — test data must not contain hex colour literals.

## In flight / next

- Nothing in flight. The branch is meant to come back to `ArndRosemeier/Tank-battle` as a pull request.
- Next slices (planned with Frank and Arnd, see `CUED.md` §4): a Node relay with `wss://` on this server that admits
  clients only with a verified pass and groups them by `raum` (lockstep over the existing `Controller` seam), cued
  invitations via a `postMessage` bridge, results to cued, then a reusable `cued-sdk`.

## Next action (one)

**Arnd decides whether to merge `feat/cued-identity`.** After a merge and `scripts/publish.sh`, open Tank Battle from
cued.de (developer page → "Spiel in cued starten") and check the badge shows his own name.

## Open questions for the owner

- Does the relay run on `apps.futuremagic.de` (Node process behind the existing web server, `wss://`)?
- Badge placement/wording on the title screen — fine as is?

## Read first

`CUED.md` → `AGENTS.md` → `docs/DEVELOPMENT-QUALITY-PROCESS.md` → `docs/CROSS-TOOL.md` → `docs/BOARD.md`.
