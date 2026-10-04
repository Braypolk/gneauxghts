# Harness, architecture fitness and cross-suite audit

Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`.
Assessment: first-party static inventory plus runner execution and targeted reproductions.

## Inventory and measurements

`measurements/inventory.json` inventories every relevant source file under `src`,
`src-tauri/src`, `src-tauri/tests`, `e2e`, and `scripts`. Excludes vendored Rust.
File-level test classification is heuristic; inline Rust test-bearing files include
production lines and must not be reported as test LOC.

- Frontend: 492 source files / 79,889 lines; 141 test files / 24,212 test lines.
- Rust application: 119 source files / 98,749 lines, 86 test-bearing files;
  728 statically detected test attributes. Architecture integration: 19 tests.
- E2E: 50 TS/JS/Python files / 7,308 lines; 32 spec files plus support tests.
- Vitest baseline: **141 files, 1,007 tests passed**, 47.52 s elapsed; reported
  transform 26.08 s, collect 468.89 s summed across workers, tests 6.08 s.
  Cold run overlapped Rust compilation, so these are diagnostic observations,
  not a repeatable performance benchmark. Do not sum worker times as wall time.
- Largest measured Vitest execution: architecture fitness 1,790 ms, including
  1,751 ms for the legacy-field compiler walk. Settings store 632 ms; History
  Mode session 451 ms. Document/workspace exhaustive sequences 165/182 ms.
- Node support/build-artifact tests: 9 passed (6.03 s, 6.00 s from the deliberate
  Rust rebuild-artifact probe). Python fixture tests: 8 passed (0.071 s).
- `pnpm check`: 0 errors/warnings and E2E type checking passed.
- Rust `cargo test --offline --no-run`: compiled successfully in 2m 13s.
  Test enumeration is saved separately. No baseline full execution before fixing
  the real-path fixture found by the persistence audit.
- Browser/native/large-history/live-provider suites were inspected, not executed
  for baseline timing. No claim of browser flakiness rate or Rust test speedup.

## H1 — Retire the vacuous, compiler-duplicating legacy-field scan

Priority: P1 test trust; confidence: reproduced.

`src/lib/architectureFitness.test.ts:6-8` builds `repositoryRoot` with a trailing
slash; `:529-532` appends `/src/lib/`. TypeScript source paths have one slash,
so the filter visits **zero application files**. Reproduction recorded
`eligible: 0`, normalized eligible: 242, total compiler files: 1,182 in
`measurements/architecture-path-repro.json`. The test reports success and spends
~1.75 seconds constructing a compiler program without exercising its assertion.

This is an obsolete migration check against fields removed from `NoteDraftState`.
Normal type checking already rejects typed `.title` and `['bodyMarkdown']`
access; a virtual compiler-host probe records TS2339/TS7053 diagnostics in
`measurements/typecheck-legacy-field-repro.json`. The existing fitness test at
`:153-168` separately pins the structured owner fields. Recommend deleting this
compiler walk, retaining ownership fitness and `pnpm check` as the required gate.
Do not replace it with another full compiler pass or a regex against every file.

## H2 — Architecture tests over-specify implementation spellings

Priority: P2; confidence: static; design judgment, not reason to remove ownership checks.

Frontend fitness `:171-195`, `:232-253`, `:302-385` and Rust fitness
`src-tauri/tests/architecture_fitness.rs:121-189`, `:835-978` pin constructor
spellings, indentation, exact calls, old helper names and documentation text.
Examples include `.note_timeline()\n        .mutate(...)` and
`catalog_projection_retries\n            .apply(`. Harmless formatting/private
decomposition can break these; a comment or dead branch can satisfy a positive
substring check. `rust_function` at `:35-59` counts braces in comments/strings
as syntax. Some scans include inline test code while others split on `#[cfg(test)]`.

Keep checks for forbidden dependencies, module visibility, canonical write
routing and ownership. Consolidate the rules into a small boundary inventory;
prefer AST/import visibility checks where syntax matters. Move ordering,
freshness and recovery assertions to executable owner behavior tests. Delete
exact-string assertions only after mapping each to retained coverage, not all
1,813 lines at once. Rust module/crate privacy can enforce several rules more
reliably than text inspection; see backend reports for possible crate extraction.

## H3 — Useful support tests are absent from the documented gate

Priority: P2; confidence: confirmed configuration.

`vite.config.js:77-81` discovers only `src/**/*.test.ts`. `package.json` exposes
the Rust artifact probe and Python fixture checks separately, but neither
`e2e/support/nativeE2EBinary.test.mjs` nor `currentScaleFixture.test.mjs` has a
script. The full gate at `e2e/README.md:107-115` omits these safety checks.
They validate artifact hashes/profiles/ports and fixture containment before
native processes launch. Add one explicit support-test command and include it
in the documented deterministic gate. Keep build-artifact stress and expensive
native/scale/live checks clearly identifiable; avoid silently hiding them in
ordinary Vitest discovery.

## H4 — Browser IPC fixture silently accepts unknown commands

Priority: P1 coverage credibility; confidence: confirmed fixture behavior.

`src/lib/e2e/browserBackend.ts:899-901` returns `[]` for any name containing
`list_` and otherwise `null`. A misspelled command or newly introduced operation
can pass a UI path without production registration or a fixture implementation.
The 963-line fixture also implements its own search, history, restoration and
settings semantics. This is useful for deterministic UI work, but is not a
backend contract oracle.

Replace permissive fallthrough with explicit command handlers plus an error for
unknown operations; declare known no-op plugin commands. Partition fixture state
by domain behind one install/reset entry point. Reuse serialized contract samples,
not backend algorithm copies. Run the entire browser suite during this migration
and add an unknown-command regression. This is a larger follow-up, because latent
reliance on `null` must be identified, not papered over with a catch-all.

## H5 — Vite harness can admit an unrelated server and has weak failure cleanup

Priority: P2; confidence: static call path.

`e2e/support/viteServer.ts:5-17,20-32` spawns Vite with strict port selection,
then accepts any HTTP 200 at that port. It never races readiness against child
exit/error and validates no fixture/mode identity. An existing server can answer
while the new owned process fails to bind. `startVite` also leaves ownership set
when readiness throws. `stopVite:35-47` sends the initial signal outside its
catch, so an already exited child can make cleanup throw.

Use one owned-server lifecycle: preflight occupied port, race child exit/error
against bounded readiness, verify app fixture mode, cleanup in startup failure,
and tolerate an already gone process group. Test with disposable child servers.
Do not generalize into a process orchestration framework or kill the listener
that happens to occupy the port.

## H6 — Clarify native gate tiers and scenario ownership

Priority: P2; confidence: confirmed configuration; not all omissions are defects.

`package.json:test:e2e:native:run` selects only app lifecycle, timeline phase 1–3
and Editing Windows. Native image, pane/chat motion and typing regressions are
manual. Live agent suites intentionally need opt-in endpoint/model/flags and
must remain opt-in; scale/process-relaunch checks intentionally use separate
release artifacts and disposable clones. Running the config glob indiscriminately
also shares a fixture across specs that documentation says need fresh invocations.

Provide explicit deterministic-native and live/scale tiers with fresh fixture per
native invocation. Keep browser primary for UI outcomes and native cases for
actual persistence/WebKit/window/filesystem behavior. Do not delete mirrored
browser/native motion cases simply because names overlap: their engines differ.
Correct README claims of restart coverage where a spec only reconnects the
driver; real interruption/relaunch coverage lives in `processRelaunch.mjs`.

## H7 — E2E duplication, storage leakage and fixed waits need focused consolidation

Priority: P2/P3; confidence: static, runtime impact unmeasured.

`e2e/specs/browser/document-and-pane.spec.ts` spans editor selection/scroll,
history, settings, forgotten/missing recovery, navigation and chat. Split by
behavior owner and share small public-UI helpers for open-note, ready editor,
selection and fixture seeding. The split is for failure ownership, not presumed
speed. Keep one end-to-end cross-owner scenario.

At least 16 literal `browser.pause` calls total 5.7 seconds of declared waits
before loops; this is not a measured suite delay. Examples: motion `ready()`
helpers wait 400 ms, image late completion 1,100 ms, document selection 60 ms.
Use readiness/motion-complete signals for setup; retain bounded sampling windows
where the behavior under test is animation or late asynchronous completion.
Frame-count requirements such as `animation-cleanup.spec.ts:58` (>3 frames)
depend on scheduler/display load; test geometry and lifecycle unless enough
samples are explicitly a measurement precondition.

`browser.url('/')` resets module state but not localStorage. Tests explicitly
set tag visibility and cursor positions (`editor-readiness:27`,
`editor-formatting-load:83`) without a common storage baseline. Recreate or clear
app-owned storage before each independent scenario; preserve it explicitly only
for restoration scenarios. Add order-independence validation before parallelizing.

## H8 — CI and measurements are missing a single authoritative entry point

Priority: P2; confidence: repository configuration only.

The sole checked-in GitHub workflow updates documentation; no checked-in workflow
runs the test gates. External/private CI may exist and was not inspected.
The README describes a gate but the root `testing.md` is a Markdown rendering
sampler, not test documentation. Document deterministic/support/native/live/scale
commands and dependencies in one test index. Add CI appropriate to available
macOS/native runners separately; do not imply browser unit tests require a model.

Measure cold/warm collection, test execution, process-global Rust lock wait, and
browser/native wall time separately before tuning workers or deleting generated
sequences. Current evidence suggests collection/import cost and one redundant
compiler pass deserve attention before fast pure reducer cases.

## Coverage ledger

Fully inspected: package/Vite/WDIO configs, E2E README, Vite server lifecycle,
architecture fitness helpers/rules, Node/Python support runner discovery,
browser backend command handling and reset model, baseline command outputs.
Deep samples: browser document-and-pane, startup/editor readiness, formatting
load, animation/navigation/cleanup, settings and image interactions; native gate
selection, live flags and process-relaunch ownership documentation.
Inventoried but not individually executed: all 32 E2E specs and long-running
scale/provider/process probes. Other reports cover target implementations and
domain test suites. This audit is not a claim of exhaustive branch coverage.
