# Visible native Editing Window acceptance — issue 47

2026-09-06, America/Denver. Both visible native gates left by issue 43 passed after rebuilding the optimized frontend and Rust application from the completed issue-46 baseline. No product or harness changes were needed. This completes issue 47; actual interrupted-process relaunch, 10k/100k retained histories, and old-citation navigation remain separate issues 48–50.

## Build and execution identity

- Git HEAD: `fd38f83ae835a74efb7a8b14235f5634b2102074`, with existing uncommitted work. The 924-file tracked/nonignored-untracked source manifest has SHA-256 tree identity `b7803d882d8c904588877223c5d3a8e50e1a74563ef17ccec437e798e4baa740`. Every captured source file was unchanged through the build and both runs.
- Optimized E2E binary: `src-tauri/target/release/gneauxghts`, SHA-256 `7713fda7e345c7943d419aaee1961317569efa221bdd40f8cb17ec89d099061a`. Built with `e2e-wdio`; frontend built with `VITE_E2E_NATIVE=true`. The `build/` file manifest tree hash is `1c783f9ccd20d2cbdecc021c6c52603d5ae24f939b0d6acd2ad9d7f59838afbc`.
- macOS 26.6.2 ARM64, WebKit 605.1.15; Node v24.2.0, pnpm 11.21.0, Rust/Cargo 1.93.1. The complete build manifest, dirty diff/status hashes, source file manifest, and baseline archive hash are linked from [machine-readable evidence](editing-window-native-acceptance-47-measurements.json).
- Runs were sequential, with no concurrent checks or repository writes. `ioreg -n Root -d 1` showed `IOConsoleLocked=No` and on-console/login-done `Yes` immediately before each visible gate. The existing webview visibility guards and actual two-animation-frame callbacks passed without overrides.
- The test-only app identifier and temporary app-data/documents/vault isolated both runs. Native-preview used port 1430; embedded WebDriver used 4445. The fixture harness alone cloned, relocated, and removed its disposable run; the sealed master was never edited.

Exact commands, in order:

```sh
node e2e/support/buildNative.mjs --release
GNEAUXGHTS_E2E_OPTIMIZED=1 caffeinate -dimsu pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/editing-windows.spec.ts
caffeinate -dimsu python3 scripts/timeline_fixture.py native --cache /tmp/gneauxghts-window-fixture-v2-issue43
```

All exited 0. The responsiveness runner started at `2026-09-06T19:26:21.540Z` and passed two tests in 17.5 seconds. The fixture runner started at `2026-09-06T19:27:40.609Z` and passed one test in 3.9 seconds.

## Autosave and deadline responsiveness

The existing finalized-window functional journey passed, including entry sealing, revision naming, two-pane return, complete Version Restore, and fresh undo history. The responsiveness journey made twelve one-line changes in a 1 MiB editor with real debounced canonical saves. At input seven the E2E-only continuous-clock offset advanced 300,000 ms. The test verified twelve canonical-save events, deadline advancement, one deadline-finalized window before History Mode entry, two windows afterward, and continuous real animation frames.

| Measurement | Samples | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Continuous frame gap across autosave/deadline | 731 | 17 ms | 53 ms | 161 ms |
| Input to two frames | 12 | 146 ms | 168 ms | 168 ms |
| Input to observed canonical autosave | 12 | 1,240 ms | 1,281 ms | 1,281 ms |

This is a **functional gate pass with timing diagnostics**. The harness specifies no numerical responsiveness budget (`budget_ms: null`); its metric `passed: true` does not establish an unstated SLA. Autosave timing includes the real one-second debounce and canonical-read polling. Raw frame gaps, event timestamps, and all input/save samples are retained in the evidence.

## Optimized fixture paint

The unchanged schema-13 `gneauxghts-editing-window-v2` sealed master at `/private/tmp/gneauxghts-window-fixture-v2-issue43` contains three notes, 95 revisions, 92 window-evidence records, 287 receipts, zero pending windows, and zero unresolved publication intents. Its fixture manifest SHA-256 remains `0c624a25cf70593e58625031411cd8a95a6df150e222b2c9f04042590d94c0d7`; identity/generation/store/watermark and every sealed file hash passed revalidation after the run.

Each measured 1 MiB note has 40 windows plus one creation revision. Five samples per operation include native Rust, IPC, the optimized frontend, DOM readiness, and two real animation frames. Paging verifies all 41 revision rows. The existing budget is nearest-rank p95 **strictly below 250 ms**.

| Workload | Operation | Samples | p50 | p95 / maximum | Result |
| --- | --- | ---: | ---: | ---: | --- |
| Repetitive 1 MiB | Entry | 5 | 136 ms | 206 ms | Pass |
| Repetitive 1 MiB | Page 30 | 5 | 53 ms | 55 ms | Pass |
| Repetitive 1 MiB | Diff | 5 | 58 ms | 68 ms | Pass |
| Random 1 MiB | Entry | 5 | 135 ms | 174 ms | Pass |
| Random 1 MiB | Page 30 | 5 | 51 ms | 132 ms | Pass |
| Random 1 MiB | Diff | 5 | 61 ms | 66 ms | Pass |

With five samples, p95 equals the maximum. These results cover this fixture on this machine; they do not establish 10k/100k history scale or slower-hardware performance.

## Logs, cleanup, and evidence limits

- Build: `/tmp/gneauxghts-issue47/build.log`.
- Responsiveness raw log: `/tmp/gneauxghts-issue47/responsiveness.log`, SHA-256 `d4024b9c28b661341938aab7ac8f1664064dddc0f49bb9bc4fec1029b2105b25`.
- Fixture raw log: `/tmp/gneauxghts-issue47/fixture-native.log`, SHA-256 `4f135bbe7771e229579aef3f807af31a0f5c5a26b5366d8e1d2bac44fb787c56`.

[Machine-readable evidence](editing-window-native-acceptance-47-measurements.json) contains all samples, raw event intervals, exact fixture/build identities, and SHA-256 hashes for logs and supporting files. No issue-47 gate failed or needed a retry. The first run retains the service-discovery `tauri-driver not found` diagnostic and stale-element warnings; the configured embedded driver successfully ran both tests. Earlier failed attempts, including issue 43's locked-display rejection, remain preserved in [the current-format measurements](editing-window-current-format-measurements.json).

After both runs, process inspection found no native test app, WebDriver, Vite preview, or scoped caffeinate processes; ports 1430, 4445, and 1421 had no listeners. The disposable fixture clone was removed and the master revalidated before documentation writes resumed. No user app or database was reset, deleted, or interrupted.

The four historical note-timeline/editing-window release reports and measurement files retain their recorded SHA-256 hashes. Original issue-43 correctness counts and backend measurements remain historical. Driver reconnection does not prove actual native process restart. Device-write bytes, fsync counts, write amplification, and slower hardware remain unmeasured. No commit was created.
