# Combined validation

Baseline is the saved pre-reduction working tree, not Git HEAD. All commands ran from the repository root.

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | 149 files / 1,117 Vitest cases passed; 32 Node support cases passed | final-frontend.log |
| `pnpm check` | Svelte check: zero errors/warnings; E2E TypeScript check passed | final-check.log |
| `cargo check --offline --manifest-path src-tauri/Cargo.toml` | Passed without warnings | final-cargo-check.log |
| Rust architecture fitness | Owner ran 23 cases, all passed | issues/04-timeline.md |
| Independent source reviews | No unresolved findings after restoring Clear completion wait | standards-review.md, review-agent.md, root-review.md |
| Full Rust library run | Corrected full run: 743 passed, zero failed, 15 existing opt-in tests ignored | final-rust-corrected.log |
| Nine affected browser files | 40 scenarios passed across the initial run and corrected History file rerun | final-browser.log, final-history-corrected.log |

The initial Rust failure was a local HTTP fixture request read returning WouldBlock, followed by a missing request-count assertion. A native Darwin descriptor probe confirmed accepted sockets inherit O_NONBLOCK. Explicit blocking mode before the existing timeout corrects the fixture; the exact regression passed after recompilation. Evidence: issues/07-capacity-probe-socket.md, 07-socket-flags.json, 07-capacity-probe.log.

The first browser run passed 39 scenarios and failed one because the coordinator inadvertently installed a post-clear baseline wait at the earlier pagination step as well. Restored the original pagination wait and kept the canonical baseline wait after Confirm Clear. All three cases in the affected History file passed on rerun; the other eight files already passed. There are 40 distinct verified scenarios, not 42; rerun cases are not counted twice. Both initial failures and corrected results are preserved.

Native E2E and opt-in release/measurement suites were not rerun in this reduction pass. Native driver/build support was unchanged. Browser verification targets changed scenarios and the mounted behaviors used to justify removed shallow tests. Previous-pass native results are not represented as fresh runs.

No speedup demonstrated: the same frontend command reported Vitest 15.30s before versus 15.88s after, and test execution 4.28s versus 4.26s. This is maintenance reduction; fewer LOC/cases alone do not establish faster or more reliable execution.

All final gates above passed. The corrected Rust run used the default concurrent harness, preserving the load under which the socket fixture originally failed. No test assertions, deadlines or concurrency settings were relaxed. Final `git diff --check` passed.
