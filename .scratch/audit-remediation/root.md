# Backend boundaries and harness remediation

Coordinator/root; baseline cb4d4c02. Original reports retained; this report records
actual implemented decisions and distinguishes validation still running.

## Backend correctness

- **UIX-01 / issue70:** Lowercased match byte ranges now map back to original
  Unicode scalar boundaries before slicing excerpts or computing line numbers.
  Expanded lowercase `İ`, multibyte text/emoji, combining marks and long excerpts
  have literal highlight regressions. Existing ranking golden remains. Frontend
  scalar→UTF-16 rendering is independently covered by the editor owner.
- **BB-01 / issue71:** Search/related cache identity includes the current title;
  missing caller content hashes derive from the actual body. Fingerprints encode
  structured tuples, retaining float bit identity. Actual command composition
  exercises title-only and no-hash body changes against a real TestVault.
- **BB-02 / issue71:** Ordinary-note candidates are filtered before hybrid merge
  truncation. The generic merger retains broad document-kind support. A dominant
  chat candidate can no longer consume the requested ordinary-note result slot.
- **BB-03 / issue71:** The earlier fabricated projection test is honestly named
  as a lower-level gate test. A new command seam runs actual lexical/semantic
  composition, pauses delivery, commits a canonical mutation, and verifies stale
  suppression both on a cold computation and a cache hit. ReleaseOnDrop and bounded
  channels prevent stranded workers on assertion failures.
- **BP-06, CC-05 / issue72:** Gregorian month/day and century leap validation
  rejects impossible managed metadata dates. Exact UTC whole-second grammar stays
  narrow; epoch, malformed fields, offsets/fractions rejection and Unicode-safe
  invalid input are explicit. No broad timestamp format migration is implied.
- **UIX-12 / issue72:** Inspection found synchronous Tauri wrappers; this audit did
  not establish concurrent IPC execution as a reproduced user-visible race. The
  asset boundary nevertheless had a filesystem check-then-truncate publication
  operation. It now reserves with create_new, retries occupied names, and removes
  a newly reserved file if writing fails. This is bounded filesystem hardening,
  not a claim that concurrent pastes were reproduced. Two actual competing writers
  preserve distinct bytes; dangling symlinks count as occupied. Existing containment
  and exact data-URL tests remain with the asset module (timeline owner extraction).
- **BB-05 / issues72,81,83b:** Browser listener delivery is real rather than disabled;
  mounted chat tests exercise source/permission/terminal dispatch. Shared wire codec
  fixture checks remain distinct from dispatch claims. Live native evaluation
  consolidation and remaining dispatch evidence are recorded in harness-evaluations.

## Harness and test ownership

| Source findings | Issue / outcome |
| --- | --- |
| H1, CC-02 | Initial cleanup removed the vacuous legacy-field compiler scan; pnpm check retains the actual typed/Svelte/E2E gate. |
| H2, CC-01, FD-09 | 84a and timeline report: one TypeScript AST architecture suite plus structurally parsed Rust fitness. Migration-era spelling checks removed; mutation controls and behavior mapping retained. |
| H3, EH-01 | 82: pnpm test runs support Node tests exactly once before Vitest. Artifact compilation probe remains opt-in; Python warning-strict lane explicit. |
| H4, EH-05, EH-06 | 81: per-instance browser fixture, explicit command dispatch, strict identities, save target captured by currentPath, reads do not change active identity; registered callbacks receive events and exact unsubscribe semantics. Factory isolation, held-save/read/open ordering and event tests pass. |
| H5, EH-04 | 80: free-port admission, random per-child identity response, bounded fetch, early exit/spawn failure, cancellation and idempotent owned-process-group cleanup. Direct Node Vite child avoids package-manager process-group escape. Browser port override and fatal WDIO service admission prevent continuing against foreign servers. |
| H6, EH-02 | 82: nativeSuite explicit smoke/measurement/live manifests. Smoke adds images/pane/chat WebKit cases and runs every file in a fresh app fixture. Cursor/date browser geometry remains browser-primary; native image/motion/window behavior is explicitly native. |
| H7, EH-08 | 83a: seven document browser suites with all117 assertions preserved, independent storage reset on an inert owned-server page, focused shared helpers. See harness-documents report. |
| H8, EH-03 | 82: repository CI runs frontend/types/Node/Python on Ubuntu and Rust lib/fitness on macOS. Graphical/live workloads are explicit separate lanes. No unmeasured aggregate speedup claimed. |
| EH-07 | 81: removed unused large-history fixture switch/seed API; actual large-data evidence belongs to retained native/scale workloads. |
| EH-09 | 83 plus final reconciliation99d: frame samplers have deadlines, terminal errors, rAF cleanup and event/state-based settling. Native samples assert focus/visibility throughout rather than only logging it. |
| EH-10 | 83a plus final reconciliation99e and navigation follow-up: scoped clipboard/prototype/IPC instrumentation cleanup and explicit editor navigation bridge; no Vite internal dependency-URL coupling. Chat sampling cleanup is bounded and restored in afterEach. |
| EH-11 | 82: 1MiB sustained editing moved behind measurement flag; output says observation-only/budget null. Functional editing-window checks remain ordinary smoke; justified chat stall regression ceiling remains. |
| EH-12 | 80: shared listener inspection, bounded wait and WebDriver transport across process/scale/restart runners, owned nonce-admitted Vite child with cancellation, configurable ports and restart signal cleanup. Native child interruption policies stay scenario-specific: deliberate SIGKILL fault evidence is not interchangeable with graceful restart. Metrics observer disconnects on timeout and final paint requires focus/visibility. |
| EH-13 | 82: removed only the stale empty-stream assertion in sources request mode and corrected architecture integration prose. Terminal, evidence, exclusion and budget assertions retained; conflicting query mode flags now reject. |
| EH-14 | 83b delegated to UI owner; see harness-evaluations report. |
| EH-15 | 80: contextlib.closing preserves transaction semantics while closing Python SQLite connections; corruption subcases named. Native chat insertion fixture also closes explicitly. |
| EH-16 | 81/82: Atlas prototype supplies explicit command overrides instead of rewriting fixture source. Schema13 allocation experiment moved to scripts/archive with provenance/caveat README; historical evidence and original audit paths retained. Production tauri release tooling and opt-in artifact compile probe retained. |

## Validation evidence and limits

- Initial combined frontend:152 files/1,156 tests pass; later changes require final
  integration gate recorded in validation report.
- Owned-server tests6/6 and transport tests2/2 pass with disposable localhost access.
  Cancellation, hung/wrong identity, foreign listener, spawn failure, protocol/HTTP
  errors, successful bodies and stalled polling have executable regressions.
- Python fixture tests pass with ResourceWarnings promoted to errors.
- First combined Rust snapshot:734 pass,14 ignored, one stale coordinator scanner
  (module owner subsequently removed/replaced structurally) and one sandbox socket
  bind failure. The socket test passes with localhost access. This is not a final
  all-green claim; final Cargo/lib/architecture evidence is recorded separately.
- Actual mounted chat controls4/4 pass. Full browser/native validation is ongoing.
- CI has been written and its commands exercised locally; it has not been pushed
  or run on GitHub. Live model quality, full historic scale and external runtime
  downloads are not inferred from deterministic tests.

## Final coordinator acceptance

All delegated work in this report is resolved. Earlier integration-pending notes
are chronological evidence; [validation](validation.md) records the completed
combined and targeted checks. Additional ledger discoveries and their closures
are documented in [ledger review](ledger-review.md). No external/live/scale
performance or model-quality result is inferred from deterministic acceptance.
