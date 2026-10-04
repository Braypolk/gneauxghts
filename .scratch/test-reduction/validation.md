# Test reduction validation

Progress: Complete. Independent reviews have no open findings; all scoped acceptance checks passed.

Baseline is saved working tree in baseline.json, not Git HEAD. Initial Vitest collection independently counted1,137 cases (`frontend-before.json`); prior phase passed all of those and746 Rust library+23 architecture,32 support and8 Python cases. Expected final deletion:72 frontend,21 Rust library,2 architecture,1 browser and1 native case, total97. Five removed inline-format fixture rows are not counted as executable cases.

## Focused evidence

- Editor/proposals:10 files,75 tests passed (`02-focused.log`). Includes unchanged six command/parser/decorations cases and12 real proposal adapter composition cases.
- UI:8 files,99 tests passed (`05-focused.log`), down22 in affected files.
- Documents:38 files,321 tests passed (`01-focused.log`), including the independent workspace/document sequence oracles and retained real command owners.

## Acceptance plan

Independent Spec and Standards reviews against the snapshot; full frontend with JSON results; support and Python; Svelte/TypeScript and E2E typecheck; full Rust library and architecture suite in one coordinated Cargo invocation. After compilation settles, run changed browser pane motion and native lifecycle specs serially. No application runtime source change or native binary rebuild is required by test-only deletion. No runtime speedup claim from a single noisy run.

## Combined frontend and support results

- Full Vitest:143 files,1,065 tests passed (`frontend-full.log`, JSON `frontend-after.json`). Baseline1,137:72 actual executions removed. No skipped/todo cases. `frontend-case-delta.json` preserves duplicate-name multiplicity and the one surviving fixture-title correction.
- Svelte/TypeScript:0 errors,0 warnings; E2E TypeScript passed (`typecheck.log`).
- Support32/32 passed (`support.log`), Python8/8 with ResourceWarnings as errors (`python.log`).
- Initial combined Rust compile failed because two deleted cfg(test) receipt accessors still had retained reattachment callers (`rust-full.log`). Owner restored `path` and `previous_path` exactly from baseline; independent reviewer confirmed unchanged callers and methods. No assertions were dropped. Corrected full Rust suite is running in `rust-full-fixed.log`.
- Independent frontend Standards, frontend Spec and backend Standards/Spec reviews have no open findings; see review-*.md and coordinator review-root.md.

## Backend acceptance

Corrected full `cargo test --offline --manifest-path src-tauri/Cargo.toml` passed725 library tests,21 architecture tests and doc-test targets;15 existing opt-in library tests ignored (`rust-full-fixed.log`). Library execution114.53s; compilation18.54s on this run. No warnings from the final compile. Baseline746+23:21 library and2 architecture cases removed. No new skipped/ignored tests. This result supersedes the failed initial compile; its log remains preserved.

Graphical checks now run serially after Cargo completes, using unchanged application behavior and the existing pinned native E2E artifact.


## Final graphical and scope acceptance

- `pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/pane-animation.spec.ts`:10/10 cases passed (`browser-pane.log`, exit0).
- `pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/app-lifecycle.spec.ts`:2/2 cases passed (`native-lifecycle.log`, exit0), disposable vault and pinned existing native binary. Vendor diagnostics about tauri-driver and session teardown remain in log; embedded WebKit cases passed. No production/native binary change was made by this phase.
- Full unchanged graphical/live/scale lanes were not rerun; only affected browser/native files. No performance gain claimed.
- `git diff --check` passed after final edits. Final measurement is−1,835 physical test/test-only lines,49 changed source files,2 deleted files,0 new files and0 application behavior changes. Final actual reduction97 cases:72 frontend+21 Rust library+2 architecture+1 browser+1 native. Five extra repeated input fixtures removed are excluded from that case count.

All six issue scopes complete. No skipped/merged tests or moved assertions were used to produce the count. Changes remain uncommitted; prior phase work was preserved.
