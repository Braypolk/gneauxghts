# Current Editing Window format validation — issue 43

2026-09-05, America/Denver. [Issue 43](../../.scratch/note-timelines/issues/43-remove-granular-editor-history-compatibility.md) implements the requested removal of granular Editor history compatibility. The code is implemented and reviewed; available correctness and backend measurement gates pass. **The two formerly pending visible native gates passed in issue 47 on 2026-09-06 after rebuilding the optimized issue-46 source baseline.** See [native acceptance evidence](editing-window-native-acceptance-47-validation.md); actual process relaunch and larger retained-history scale remain separate follow-ups.

Only freshly created schema 13 stores are supported. Earlier/future schemas and incomplete metadata fail before schema writes. The existing confirmed Settings reset advances the generation and rebuilds exact current Markdown as Baseline Revisions. No user database was deleted or reset by this task. Granular Editor grouping, DTO fields, migrations, trust authorization, old writer switches, and the retired 100,000-revision fixture harness are removed. Creation/baseline/action/external points and explicit Editor creation/rename/move boundaries remain supported.

## Correctness and review

| Check | Result |
| --- | --- |
| Full Rust suite | 529 unit tests and 16 architecture tests passed; 4 opt-in diagnostics ignored |
| Full frontend suite | 797 tests across 122 files passed |
| Fixture safety tests | 6 passed |
| Svelte/TypeScript check | 0 errors, 0 warnings |
| Browser journeys | 11 passed |
| Native functional journeys | 8 passed: 3 lifecycle/bridge, 4 history, 1 Editing Window |
| Native autosave/deadline responsiveness | Issue 47: visible functional gate passed; 731 frame samples, 12 real saves, deadline sealing; timing diagnostics have no numerical budget |
| Optimized native fixture entry/paging/diff paint | Issue 47: all six p95 paint gates passed below 250 ms; five samples each |

The regression suite verifies unchanged database bytes when rejecting unsupported schemas or incomplete metadata, schema-12 confirmed reset without rewriting canonical Markdown, generation advancement and baseline reconstruction, rejection of relabeled granular Editor rows, and legitimate changed-content-plus-rename publication. Existing capture/recovery/receipt/citation/portability checks pass. Independent review findings were addressed: full metadata preflight precedes writes, point-Editor header validation uses indexed exact-identity lookup, and current fixture markers agree across generator and native runner.

One existing Rust test omitted its temporary vault override (`abandoned_move_reservation_cannot_assign_identity_to_a_later_unrelated_file`). Its first index upsert was blocked by the sandbox with EPERM; adding the temporary override isolates it correctly. The final suite passes. Initial fixtures assuming every save was retained were replaced with explicit current-policy boundaries, including cross-module Missing/Forgotten Note tests.

Embedded WebDriver `reloadSession()` only deletes/recreates driver session state; the installed `tauri-plugin-wdio-webdriver 1.3.0` handler does not restart Rust. Current journey wording now says driver reconnection. The history journey proves a saved pending window survives reconnection and is finalized by explicit History Mode entry. **Actual native process-restart behavior is not measured here.** Fresh-AppState startup/recovery is covered by Rust tests and the diagnostic below. Historical reports remain unchanged; this paragraph corrects interpretation of the current native harness.

## Current backend measurements

Fixture: `/private/tmp/gneauxghts-window-fixture-v2-issue43`, marker `gneauxghts-editing-window-v2`, schema 13. It is a sealed master reused only through disposable clones.

- 3,600 changed saves produce 12 Editing Windows plus one creation revision, with 77 retained receipts.
- Two 1 MiB notes each contain 40 windows from 120 changed saves.
- Complete fixture: 95 revisions, 92 window-evidence records, 287 receipts, zero pending windows or unresolved intents.
- Measured before final clean close: 4,165,632 main-file bytes, 0 WAL bytes, 32,768 ephemeral SHM bytes; 635,783 retained revision-payload bytes and zero pending/terminal-intent payload bytes. Allocated storage includes reclaimable pages and does not measure cumulative device writes.

| Backend operation, 1 MiB | Repetitive p95 | Random p95 | Samples each |
| --- | ---: | ---: | ---: |
| Save | 28.16 ms | 31.06 ms | 120 |
| Window finalization | 39.43 ms | 41.61 ms | 40 |
| Page 30 | 31.01 ms | 30.88 ms | 20 |
| Parent diff | 18.07 ms | 18.17 ms | 20 |
| Reconstruction | 13.47 ms | 13.72 ms | 20 |
| Restore preview | 15.26 ms | 15.47 ms | 20 |

All measured page/diff budgets (250 ms) and reconstruction/restore-preview budgets (1 second) passed. The separate current-only diagnostic exercised small/full changes on repetitive/random 1 MiB notes: 128 saves per workload retained one net window. Save p95 ranged from 28.29–32.85 ms. Fresh-AppState reopen after clean close took 9.81–11.89 ms, **one sample per workload within the same process with warm OS caches**. These are not native startup percentiles or slower-machine measurements.

No legacy writer comparison was rerun. Actual device-write bytes, fsync counts, write amplification, and slower hardware remain unmeasured. The [machine-readable evidence](editing-window-current-format-measurements.json) preserves exact metrics, fixture identity/counts, raw-log paths and SHA-256 hashes, and hashes confirming all four historical release reports/measurement files are unchanged from the follow-up baseline.

## Failed attempts and completed native follow-up

Raw logs preserve the initial sandbox loopback-bind failure, outdated fixture expectations, driver-reconnection assumption, and locked-display rejection. Browser tests passed after local-server escalation. Native history passed after fixing fixture semantics. `ioreg` confirmed `CGSSessionScreenIsLocked=Yes`; the visibility guard was retained and no hidden paint measurements were accepted.

Issue 47 rebuilt with `node e2e/support/buildNative.mjs --release`, then completed these commands sequentially on an unlocked display with no concurrent repository writes or checks:

```sh
GNEAUXGHTS_E2E_OPTIMIZED=1 caffeinate -dimsu pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/editing-windows.spec.ts
caffeinate -dimsu python3 scripts/timeline_fixture.py native --cache /tmp/gneauxghts-window-fixture-v2-issue43
```

The optimized binary and frontend were rebuilt from the completed issue-46 code. Both commands exited 0. Frame-gap p95 was 53 ms (731 samples); input-to-two-frames p95 was 168 ms (12 samples), with no numerical responsiveness budget asserted. Fixture paint p95 values were 206/55/68 ms for repetitive entry/page/diff and 174/132/66 ms for random entry/page/diff (five samples each), all below the existing 250 ms budget. Exact source/build/fixture identities, raw logs and hashes, samples, and limits are in [issue 47's report](editing-window-native-acceptance-47-validation.md) and [measurements](editing-window-native-acceptance-47-measurements.json). All test processes, scoped caffeinate processes, and isolated test listeners were stopped before documentation writes resumed. Earlier failed logs and all four historical release evidence files are preserved. Actual interrupted-process relaunch (issue 48), 10k/100k retained histories (issue 49), and old-citation navigation (issue 50) remain outside these results.
