# Tank Battle — evidence-driven development process for the authoring model

## 1. Registered shortcomings (observed in the Tank Battle audit)

These are **concrete failures or risks found in this repository**, not generic rules about AI. A passing build is not proof that the program does the right thing.

| ID | Shortcoming and evidence | Failure it can cause | Classification |
| --- | --- | --- | --- |
| S1 | `src/core/ai/teamBatch.ts` indexed character profiles with `tank.teamId` although profiles are assigned by `tank.teamIndex`. | Valid-looking but falsely attributed damage, deaths and character-balance statistics. | **Confirmed correctness defect** |
| S2 | Live team, spectator and batch modes repeated team spawning, AI seed/phase assignment and command collection. Some differences were intentional (batch tank-ID permutation), but not centralized or explicit. | Modes silently diverge while tests of each mode remain green. | **Confirmed duplication / drift risk** |
| S3 | Three places assembled renderers and post-processing independently. Title-frame error handling set `disposed = true` before calling the cleanup routine, so actual cleanup returned early. | Inconsistent visual setup; leaked WebGL resources after a failure. | **Confirmed cleanup defect and duplicated setup** |
| S4 | `playableScene.ts` reconstructed firing/impact events by comparing shell lists between rendered frames. | A short-lived shot or impact can occur entirely between two render frames and be missed. | **Architectural correctness risk** |
| S5 | `sceneBudget.test.ts` measured an older showcase rather than the actual playable 4×4 scene. | The test passes even if the shipped game's draw-object budget regresses. | **Mis-targeted test** |
| S6 | Browser UI, settings, pause/resume, audio unlock and real transitions had little automated browser coverage. | Green headless tests while the playable product behaves incorrectly. | **Verification gap** |
| S7 | Dev asset paths and the core-purity source scan assumed Unix-style `/` paths; a demanding title test hit Vitest's default 5-second timeout on Windows CI. | Windows-only failure invisible to Linux-only test runs. | **Confirmed cross-platform defects** |
| S8 | `HANDOFF.md` and sections of the architecture notes lagged behind the actual commits and publication status. An early audit report preceded CI evidence. | A successor model reads stale facts or reports unverified work as finished. | **Documentation/evidence drift** |
| S9 | `src/main.ts`, `src/core/sim/step.ts` and `src/core/ai/controller.ts` became large orchestration centers. | The next feature is bolted onto a crowded module; change impact is hard to see. Size alone does not prove bad design. | **Outstanding maintainability risk** |

**Do not reinterpret an identified risk as a reproduced gameplay bug.** The distinction matters: S4 was a proven fragile mechanism; it was not measured as a specific lost-audio incident. Also do not blame the original model for choosing deliberately different game modes.

## 2. What was done to fix it

This remediation was developed on branch `improve/code-quality-audit-20261022`, PR #1.

| Registered issue | Actual change | Evidence or limitation |
| --- | --- | --- |
| S1 | Character accounting now indexes `selectedProfiles[tank.teamIndex]`. `src/core/ai/teamBatchStats.test.ts` exercises **2 teams × 3 slots** so a team-ID/slot swap becomes visible. | Regression test + cross-platform CI. |
| S2 | `createTeamMatch` and `createTeamAIController` in `src/core/ai/teamBatch.ts`, plus `collectControllerOrders` in `src/core/sim/controller.ts`, replace repeated implementations. Seeded batch-order differences remain explicit. | Existing deterministic session and batch tests remain the parity constraints. |
| S3 | `src/render/renderStack.ts` owns shared renderer/post stack creation. Title-frame error handling uses the real `dispose()` path; disposal is idempotent. | Browser smoke covers normal launches; injected GPU failures still need dedicated tests. |
| S4 | Match simulation captures fire, impact, hit and death events at simulation-tick resolution; `playableScene.ts` consumes the queue once. Headless matches opt out. | `src/render/presentationEvents.test.ts`; **terrain break/regen events still use world-revision snapshots**. |
| S5 | Real playable-scene budget coverage supplements the old showcase benchmark. | `src/render/sceneBudget.test.ts`; software scene counts are **not** measured GPU frame rates. |
| S6 | GitHub Actions includes `quality.yml` (Ubuntu + Windows) and `browser.yml` (Chromium). `scripts/browser-smoke.mjs` exercises multiple UI/game modes. | Browser smoke is still not a full accessibility, GPU-soak, audio-timing or visual-quality assessment. |
| S7 | `scripts/assetPath.ts` performs containment-based asset resolution; source-scan paths normalize separators; title test has an explicit larger time budget. | The original Windows CI failures were corrected. |
| S8 | `HANDOFF.md`, `docs/BOARD.md`, README and audit notes were reconciled, and MIT licensing added with owner approval. | Historical ledger entries stay historical; do not use them as a live status check. |
| S9 | Some shared seams were extracted. **No claim of complete decomposition** of `main.ts`, `sim/step.ts` or the AI controller. | Keep this as explicit technical debt, not an automatic reason to rewrite. |

**Verification provenance.** On commit `9b2c794` (2026-10-22), GitHub Actions completed successfully for Ubuntu and Windows build/tests and Chromium smoke ([quality run](https://github.com/ArndRosemeier/Tank-battle/actions/runs/39832602999), [browser run](https://github.com/ArndRosemeier/Tank-battle/actions/runs/39832603140)). This verifies **that commit only**. It is not evidence of a local full gate, a human visual verdict, or deployment; later edits require fresh verification.

## 3. Mandatory development process from now on

This is a **specific quality supplement**, not a replacement for `AGENTS.md`, `docs/CROSS-TOOL.md` or `docs/WAY-OF-WORKING.md`. The existing chief-of-staff, writer/worktree, gate and handoff contracts continue to govern how work is dispatched and landed.

### 3.1 The six decisions to make *before* writing code

For every behavior-changing slice, write a short brief with these fields. If a field is irrelevant, write “not applicable” **and why**.

```text
INTENT: What observable player or operator outcome should change?
AUTHORITATIVE DATA: Which types/fields own this fact? What do IDs/indexes mean?
ONE SEAM: Where does this behavior already live? Search all modes/callers.
COPIES: n→1 — ... OR COPIES: 1 — checked (grepped: ...).
CORRECTNESS: At least one invariant and one failure/edge case to prove.
PROOF: Unit/integration test, actual gameplay/browser, and/or batch evidence.
```

**Example (the real S1 bug):** “A character is selected by `tank.teamIndex`, not `tank.teamId`. For 2 teams × 3 character slots, each character must be credited with exactly 2 tank appearances, and summed deaths may not exceed 6.” This would have caught the defect before tuning any AI character.

**Stop and inspect** if you cannot name the authoritative field, find all existing implementations, or state how to tell a correct fix from a plausible-looking one. A small read-only probe is cheaper than speculative code.

### 3.2 Reconnaissance: search first, patch second

1. Read `AGENTS.md`, `docs/CROSS-TOOL.md`, `HANDOFF.md` and the seam table in `docs/ARCHITECTURE.md`. Run `node scripts/cos.mjs status --one-line` and reconcile against the remote, worktrees and gate lock as already required.
2. Search with `rg` or GitHub code search for the behavior, similar helpers, callers, tests and comments. For a team feature, inspect **play, team, spectator, title and batch** code, not just the first file found.
3. Decide the **single owner** of the fact or algorithm. Reuse its existing public interface where possible. If the same idea lives in two places, either consolidate or record the justified difference explicitly.
4. Look at the previous regression test before editing. Ask “could this test pass while the user-visible behavior is still wrong?”

Useful probes (not verification commands):

```sh
rg -n 'createMatch|new AIController|teamControllerSeed|collectControllerOrders' src
rg -n 'requestAnimationFrame|new WebGLRenderer|createRenderStack|dispose\\(' src
rg -n 'teamId|teamIndex|tankId|selectedProfiles' src
rg -n 'presentationEvents|takeEvents|setShells|world.revision' src
```

**No speculative framework-building.** Extract the smallest seam that really has multiple consumers. Preserve intentional differences as explicit parameters. Do not break a stable subsystem into tiny files just to reduce line counts.

### 3.3 Data-contract checks: identities, boundaries and invariants

- Never substitute an **identifier** for an **index**. `teamId` names a team, `teamIndex` names a slot/profile within a team, and `tankId` identifies one tank. The same numerical values in a 4×4 case do **not** make them interchangeable.
- At every data boundary, validate shape, finite numbers, bounds, uniqueness and missing references. A missing required value is a visible error, never an invented zero or empty object. Preserve the existing “no silent fallback” rule.
- For every report or batch, add a conservation check: totals across characters/teams must agree with the match totals, within the documented definition. Use **unequal dimensions**, nonzero offsets and changed seeds to expose indexing mistakes.
- For determinism, prove both **same seed + same inputs → same expected outcome** and **a changed relevant input causes the intended change**. Merely comparing two executions of the same buggy implementation is weak.
- Preserve the layer boundaries: `src/core` owns deterministic world/combat and events; `src/game` owns session orchestration; `src/render` owns graphics; `src/entry` owns browser wiring. Rendering must not silently invent gameplay rules.

### 3.4 Time, events and resource ownership

Use one of two contracts for every new datum:

| Datum | Correct contract | Incorrect shortcut |
| --- | --- | --- |
| Persistent state (tank HP, world cells, shell positions) | Authoritative simulation state; interpolate or snapshot when rendering needs it. | Maintain a second mutable “truth” inside UI code. |
| One-time occurrence (shot, collision, death, sound cue) | Emit during the simulation tick; buffer in order; drain exactly once. | Infer only from frame-to-frame object differences. |
| Renderer/audio/browser resource | One creator and one idempotent cleanup owner; cleanup also on initialization failure or exceptions. | Flip a `disposed` flag before cleaning, forget listeners/timers, or allow two render loops. |
| Tunable presentation value | One config owner and one path for live updates. | Repeat bloom, colors, camera sizes or resolution values in separate modes. |

If a new feature adds a listener, timeout, requestAnimationFrame, AudioContext, GPU object or observer, name **who disposes it** in the brief and test the exception path when feasible.

### 3.5 Testing: prove a failure, not only a success

Write the smallest regression test that fails against the old behavior (or a deliberately injected bad implementation), then prove it passes with the change. For cross-cutting changes, exercise a second consumer. Keep the test independent of the code path it is supposed to challenge.

| Change type | Required checks beyond normal gate |
| --- | --- |
| AI, match rules or statistics | Deterministic Vitest tests, asymmetric fixtures, aggregate invariants and representative seeded batch comparisons. |
| New game/session mode or shared setup | Check parity and documented differences among player, spectator, title and headless batch; preserve seeded behavior. |
| Visuals, camera, shaders or UI | Test the **actual playable scene**; run Chromium interaction and screenshots on the affected mode, including viewport changes; inspect the images. |
| Time-dependent effects or audio | Multi-tick/single-frame regression, exactly-once event consumption, and slow-frame/browser test where relevant. |
| Asset paths, scripts, CI or platform glue | Windows **and** Ubuntu checks, encoded/path escape cases, correct publish/base path and actual asset HTTP responses. |
| Renderer lifecycle / memory | Normal exit, double-dispose, exception cleanup and repeated screen/match transitions. |

One screenshot of an opening frame is **not** evidence of animation. Capture separated real-time frames and confirm movement. A static-geometry budget test is **not** an FPS test. A browser smoke pass is **not** a human look, feel or audio approval.

### 3.6 Tool contract: use what the project already has

| Tool | Use it for | Do not confuse it with |
| --- | --- | --- |
| `rg`, `git diff`, `docs/ARCHITECTURE.md` | Finding the existing owner, duplicates and affected callers. | A passed test. |
| TypeScript strict mode, Vitest | Data contracts, deterministic behavior and unit/integration regression pins. | Browser behavior or GPU performance. |
| `bash scripts/gate.sh` | **One authoritative local verification route**: build then tests, journaled, locked. Exit `0` = both passed; `1` = failure; `2` = cheap only; `9` = refused/void. | A plain `pnpm build` or a claim that CI probably passed. |
| `scripts/shot.sh`, `scripts/shot-live.sh`, Chromium / `scripts/browser-smoke.mjs` | Actual page state, animation, UI transitions, visible regressions. Use existing screenshot/capture helpers. | A simulator correctness proof, or a substitute for reviewing screenshots. |
| `pnpm batch`, `pnpm player-batch`, `pnpm round-robin` | AI behavior, balance and seed distributions. Record seed range, thresholds and metrics. | A single example match that “looked fine.” |
| GitHub Actions (`quality.yml`, `browser.yml`) | Independent cross-platform and browser checks on the **exact commit SHA**. | Permission to merge a known gameplay/visual defect. |
| `HANDOFF.md`, `docs/BOARD.md`, `docs/TESTING.md` | Current baton, state of record, and actual verification evidence respectively. | A transcript or a history dump of the last 50 sessions. |

Follow the existing shared-host hygiene: at most two writers, separate worktrees, no concurrent full gates, kill browser process trees, and do not pipe the gate through `tail`/`head`. A tool failure must appear in the landing report, not disappear behind a hopeful summary.

### 3.7 Landing contract — five checks, all required

Before declaring a behavior-changing slice **VERIFIED**:

1. **Meaning:** state the user-visible acceptance target, and which explicit failing/edge scenario now passes.
2. **Copies:** provide the exact `COPIES` line; show searches or a reason why duplicate logic was not consolidated.
3. **Evidence:** quote the **full gate exit code, test counts, commit SHA**, plus browser/seed/visual evidence relevant to the change. CI must belong to the same SHA. Do not call the cheap tier a full pass.
4. **Risk:** explicitly state what was **not** tested (for example, real GPU speed, audio timing, Windows behavior, or long soak). These are not grounds to invent confidence.
5. **Baton:** update `HANDOFF.md` and the current board in the same landing process, reconcile remote state, preserve historical proof in the ledger, and leave one next action. Follow the existing worktree and integration rules in `AGENTS.md`/`docs/CROSS-TOOL.md`.

Suggested concise report:

```text
INTENT / RESULT: ...
SEAM / COPIES: ...
TEST: full gate exit ...; ... tests; commit ...
BROWSER / BATCH: mode, seed, frame, result ...
NOT VERIFIED: ...
NEXT ACTION: ...
```

### 3.8 Stop rules for a smaller but instruction-following model

**Do not improvise past these triggers.** Report BLOCKED with the exact evidence and a concrete option for resolution when:

- the requested change contradicts a documented game invariant or the owner’s intent;
- two modules both claim to be the authority for the same state or behavior;
- a metric cannot be attributed unambiguously (ID versus index, seed versus corner, numerator versus denominator);
- a test fails without a diagnosis, a browser produces errors, or cleanup leaves resources running;
- the only evidence is a build, a stale CI run, an old showcase, or an uninspected screenshot;
- more code would be needed to hide an error with a fallback rather than expose it.

**The goal is not more process. It is fewer unexamined assumptions.** For simple isolated edits, the brief may be six lines. For cross-cutting changes, add the tests and proof that the changed behavior actually needs. Never make a new parallel gate, handoff system or instruction source.