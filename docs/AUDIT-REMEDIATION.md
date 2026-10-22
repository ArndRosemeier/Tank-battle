# Code-quality audit remediation (2026-10-22)

This is an audit change, not a redesign. All branch changes require independent gate and browser verification before merge.

## Shipped in this branch

- Fix character metric lookups: `tank.teamIndex` chooses the character, not `tank.teamId`.
- Resolve asset paths using platform-independent containment checks; test POSIX and Win32.
- Cleanup title renderer through the real disposal path following frame failures.
- One `createTeamMatch` and `createTeamAIController` seam serves live team, spectator and batch modes. One `collectControllerOrders` function serves all headless command collectors.
- Browser-input preventDefault only when game canvas is focused; remove context-menu listener on disposal.
- Test the real scene alongside the older showcase budget.
- Add cross-platform GitHub Actions and browser smoke workflows.
- README explains how to run and test the project. Licensing still requires the owner's explicit selection.

## Remaining tasks, deliberately not disguised as complete

1. A **tick-level presentation-event stream**: the renderer currently discovers shell firing and impacts by frame-state diffs; rapid changes between rendered frames can be missed. Add typed event records to the simulation and consume/drain once, with deterministic tests.
2. **Consolidated renderer bootstrap**: title, spectator and player setups still have repeated WebGL renderer/post-processing configuration. Refactor only with browser screenshots and disposal tests available.
3. **Full Chromium interaction suite**: current smoke tests title/team boot and a few user gestures. Extend to every menu, settings, pause, resize, audio unlock, transitions, and lifecycle failure injection.
4. **Documentation archival**: historical ARCHITECTURE/TESTING/LEDGER material is valuable as evidence; compact the active index only after confirming link targets and migration.
5. **Completed:** owner selected MIT; the standard LICENSE file is committed.

## Verification truth

Repository was edited through GitHub connector. The owner-specified Windows folder is not accessible from this ChatGPT environment. No `pnpm` install, build, full gate, or interactive browser run was performed here. CI workflows were added as an independent check, **not** proof they passed.

COPIES: 3→1 — team match setup and controller seeding in `src/core/ai/teamBatch.ts`; 4→1 — order collection in `src/core/sim/controller.ts`.
