# Pre-merge validation

Progress: Complete. All final local acceptance gates passed; initial intermittent browser failures remain documented as open follow-ups.

## Proposed merge and clean checkout

Original detached HEAD: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`, plus the accumulated working-tree changes. Local `main`: `04f13b35a253974c01070a7502c940e20332b165` (adds Open File Location). No fetch, push, merge, commit or staging of the original checkout was performed.

Disposable validation repository: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-premerge-39n5lbfr`. Its temporary local commits identify the proposed snapshot and integration. `candidate.json` enumerates included files and excluded local artifacts. All tracked existing files and intentional new source/configuration/fixtures/Markdown reports were copied; untracked Python caches and raw scratch logs/scripts/snapshots were excluded. The snapshot included 383 intentional untracked paths and excluded 536 generated/local diagnostic paths. This does not delete or stage anything in the original.

Integration with local main found one import conflict in Notepad.svelte. Keeping both the native contract probe and `revealItemInDir` imports preserves both changes; the remaining Open File Location changes merged automatically. `integration-with-main.patch` records the complete integration result. The original checkout still needs that resolution when actually merged.

The clean repository began with no node_modules, Svelte/Vite output or Rust target directory. Frozen-lockfile offline dependency installation failed because package archives were missing. A frozen-lockfile online install succeeded; package-manager download caches were permitted, but no original application build/test cache or node_modules was copied. Rust rebuilt in the new checkout using locally cached crate sources. All five compressed histories are included and their consumers passed from the relocated source tree.

Local environment: macOS 26.6.2, Node 24.2.0, pnpm 12.8.1, Rust/Cargo 1.93.1. CI config uses pnpm 10 and separate Linux frontend/macOS Rust jobs; this report establishes local acceptance, not execution of remote CI or Windows behavior.

## Findings and corrections

1. **Concurrent split exceeded pane capacity.** Two overlapping preparations admitted four panes with a limit of three. The new regression failed with expected 3/actual 4; rechecking capacity immediately before membership/draft creation fixes it through the existing cleanup path.
2. **Generic note navigation replaced an active chat unnecessarily.** The strengthened existing test reproduced chat-to-editor conversion and loss of its displayed conversation reference despite an available editor. Generic navigation now uses and activates the existing nearest-editor selector. Explicit pane history, citations and proposal placement retain their separate targets and save/finalization barriers. This mismatch also existed in the pre-refactor controller; it is not falsely attributed as a new rewrite regression.
3. **Forced native-suite cancellation orphaned an inherited child.** A real owned listener survived launcher exit 143 after the ten-second fallback. The fix owns a Unix launcher process group and reaps residual descendants on forced or graceful launcher exit. Initial graceful signaling and Vite's independent cleanup remain. After correction the descendant is gone while an unrelated sentinel survives. Windows retains its existing PID-only behavior. The existing fast cancellation test was strengthened; no ten-second test was added to the ordinary suite.
4. **Cursor test could construct an invalid DOM range.** A single-character text node containing W caused offset 2 to exceed length 1. The sampler now requires an available interior character before measuring it; all cases, minimum row coverage, geometry bounds and native-selection assertions remain.

Independent reviews cover backend, timeline/evidence, frontend, document/workspace, and deletion/harness reconciliation. Follow-up reviewers checked the workspace and process-group fixes. No further confirmed production finding was reported in those reviewed scopes. The coverage review reconciles all 16 removed whole test modules, with explicit limits on assertion sampling rather than claiming exhaustive equivalence of every removed line.

## Validation evidence

| Gate | Result |
| --- | --- |
| Clean default-concurrency `cargo test --offline --locked` | 725 library passed, 16 intentional opt-ins ignored; 21 architecture passed; binary/doc targets passed with no tests. Library execution 75.82 s; cold compile and complete command 160.68 s. |
| Clean non-test Rust build | Passed. |
| Clean frontend production build | Passed. |
| Svelte/TypeScript and E2E types | Passed, zero Svelte errors/warnings; E2E types passed again after final harness/cursor changes. |
| Final frontend/support suite | 1,066 frontend tests in 143 files and all 32 support tests passed (`clean-frontend-final.log`). |
| Python fixture checks with ResourceWarning elevated | 8 passed. |
| Focused workspace integration | 55 passed after both corrections; final full suite includes the extra active-pane assertion. |
| Forced cancellation reproduction | Failed before, passed after; unrelated sentinel and detached-server cleanup verified. |
| Full proposal whitespace check | Passed after removing four trailing blank lines, including previously untracked files. |
| Native smoke | Seven files passed: 12 cases, one existing sustained-measurement opt-in skipped. Fresh binary SHA256 `9a8c4efe3e9ee4751f9392e0ac880c0fda38f2ee3aa92853d77b984953b94dc9`. |
| Actual process restart | Passed: clean-close receipt, post-close mutation rejection, old PID exit, new PID recovery of pending endpoint and anchor, continued save and second clean close. `native-restart-result.json` retains the evidence. |
| Final complete browser suite | 26/26 files, 109 cases passed in 190.36 s (`clean-browser-final.log`); no diagnostic instrumentation retained. |

Durations here are execution records, not a performance comparison: ordinary non-UI checks sometimes overlapped. Browser/native checks run serially without heavy builds or source changes in the candidate.

## Browser failure record

Initial complete browser execution: 24/26 files passed. Cursor geometry had ordered/task row, invalid heading DOM range and native-selection failures; formatting-on-load had missing Alpha result-panel failures. Failure screenshots and context paths remain in `clean-browser.log`. Both files then passed unchanged in isolation (12 cursor plus 5 formatting cases).

Only the DOM range defect has an established correction. Other initial failures are intermittent and their causes are not proven. In particular, formatting screenshots retain the Alpha input text while the result panel is absent; delayed focus restoration is a hypothesis, not an established product defect. No search/focus production change, timeout increase, blanket retry or assertion removal was made to make those cases pass. Optional diagnostic variants remain outside proposed source files. Issues 04 and 05 preserve the evidence and uncertainty.

Native logs contain upstream diagnostics about an absent external tauri-driver despite configured embedded-driver use, mock cleanup after session removal, and Vite/esbuild shutdown noise after both restart processes exited. Exit statuses and assertion results above passed; this is not a claim of warning-free dependency stderr. No driver installation or unrelated dependency change was made.

Source inclusion audit compared 1,076 non-scratch files between original and candidate: none missing and no unexpected differences. The only intended integration differences are main’s four Open File Location paths. `final-source-manifest.json` records candidate hashes, including the new history archives.

## Readiness and handoff

The proposed integration passes the final local gates listed above. Four confirmed defects found during this validation are corrected and included in the tested source; independent reviews found no further confirmed production blockers in their stated scopes. The final full browser run passed after the bounds correction, but it does not establish a fix for the earlier intermittent selection/search failures. Keep issues 04 and 05 open for a future discriminating reproduction; do not describe the browser suite as proven stable.

`final-integrity.json` confirms all 1,076 recorded candidate source hashes still match, no unexpected original/candidate source drift exists, the full proposal whitespace check passes, and both original HEAD and local main are unchanged. `premerge-fixes.patch` records the exact nine-file correction delta from the temporary integrated candidate commit `c54adae4`. The candidate retains that tested delta uncommitted for inspection. `integration-with-main.patch` records the separate four-file main integration.

Before the actual merge, include the intentional untracked source/configuration/fixture files recorded in `candidate.json`; a tracked-files-only commit would omit required work. Resolve the single Notepad.svelte import conflict as recorded above. The original checkout has not been staged, committed, merged or pushed. Remote CI and non-macOS runtime behavior were not exercised, and timing here is not a controlled performance benchmark.
