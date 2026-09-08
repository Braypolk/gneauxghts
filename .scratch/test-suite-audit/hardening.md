# Pre–Phase 4 test hardening

Completed the four authorized corrections. Changes are limited to three frontend test files and the test module in `src-tauri/src/semantic/debug.rs`; application behavior is unchanged.

- Architecture fitness now rejects each forbidden controller field individually.
- Settings visibility checks each section independently and verifies that unrelated loaders do not run.
- Search uses Vitest fake timers. A burst of inputs must produce exactly one final-query request and highlight update after the debounce deadline. Clearing an existing search must remove results, clear highlights once, cancel pending work, and remain cleared after time advances.
- RSS configuration and disabled-sampling assertions now run in one environment-owning test. A local drop guard restores the previous environment value even during assertion failure. All previous assertions remain; combining the two scenarios removes their competing writers.

## Verification

- Full frontend suite: **771 passed**, 122 files.
- Full Rust suite: **446 unit tests and 15 architecture tests passed** under normal parallel execution. The one-test reduction combines the RSS scenarios without losing assertions.
- `pnpm check`: **zero errors and warnings**.
- Changed Rust file passes `rustfmt --check`; `git diff --check` passes.
- Isolated regression probes: the 21 affected frontend cases pass on unmodified application code. Adding forbidden controller state, swapping the settings loaders, and disabling search timer cancellation produces five expected failures across the three test files. This confirms the corrected assertions catch these regressions. The probes do not modify the working application.

Disposable run logs and temporary probe paths were removed during pre-commit cleanup. Browser/native journeys were not rerun for these test-only changes; their prior passing runs remain recorded in the [Phase 1–3 fixes](../note-timelines/reviews/phase-1-3-final/fixes.md).

The localized diff was reviewed against the authorized scope and repository standards. No further findings arose in that review. The broader audit's deferred removals and production-path improvements remain separate follow-up work; they are not prerequisites added to this pass.
