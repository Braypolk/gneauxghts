# Combined Pi cleanup merge readiness — 2026-10-16

Ready for commit preparation and merge into local `main` within the agreed desktop
scope. No merge, commit or push was performed. Physical iOS, hosted-provider
credentials, foreground paint/gesture lanes and resource measurements remain
outside this acceptance pass.

## Scope and comparison

Waited for the parallel map/settings/transcript removal to finish before starting
this pass. It combines that removal with the shared search/hash extraction and
the ordinary Pi rebuild/adapter alignment. Earlier independent Standards/Spec
reviews remain applicable; the small corrections below were checked locally
against both behavior requirements and their current owners.

Branch `codex/pi-durable-native-prototype`, HEAD
`64cc3ff656f05d18d4e25ef3fea7695b07cbafb1`; effective scope includes untracked
implementation, tests and docs. Local `main` is
`160085d6f6c619189ce5d2faadef987915d94bff` and is an ancestor of HEAD.
Fresh `git fetch origin main` found remote main still at
`c9b8a99033de9ac6a4b01b8afd6ba369f418da50`: local main is 11 commits ahead,
with no remote-only commits. Refresh that reference again at the eventual merge.

## Corrections found by the broad checks

- Chat teardown remeasured a collapsed viewport and overwrote the pane's saved
  reading position. Retained scroll events now own its capture; removing the
  teardown capture fixes note/chat replacement without changing Pi execution.
- Restored the existing `data-pane-content` marker on the message log. Shared
  pane/rail tests can observe the actual chat surface through their ordinary
  selector; no motion assertions or tolerances were weakened.
- Restored the existing touch/IME input rules from main: touch Return inserts a
  newline; composing Return, including Safari keyCode 229, never submits;
  desktop Enter sends and Shift+Enter inserts a newline.
- A repeated native publication run exposed a test restart race. A visible chat
  does not mean workspace restoration has released its operation. The isolated
  E2E bridge now observes that existing guard, and restart acceptance waits for
  it before submitting the next effect. Native publication admission still
  rejects a busy workspace; no effect retry or production bypass was added.

## Validation

| Check | Result |
| --- | --- |
| `pnpm check` | Passed; zero Svelte errors/warnings and E2E TypeScript passes |
| `pnpm test` | 1,166 frontend tests / 145 files; 32 support tests passed |
| Full `cargo test --manifest-path src-tauri/Cargo.toml` | 670 unit and 24 integration tests passed; doc-test phase passed; 19 existing ignored tests |
| Fixture safety checks | 16 passed |
| Rust build artifact test | Passed |
| Rust formatting and `git diff --check` | Passed |
| Production build | Passed; no native/browser/simulator acceptance bridge markers in emitted JavaScript |
| Full browser sweep and corrected-file reruns | All 309 scenarios / 49 specs covered successfully after the corrections below |
| Native smoke, `GNEAUX_PI_PROCESS_RESTART=1` | 28 passed / 7 independently launched specs, including actual process reopen |
| Live configured Qwen | 2 passed: text/reasoning streamed in Pi and rendered UI before completion; native search/read and citation navigation |

The first full browser command exited nonzero: 303 scenarios passed and six
failed across four files (45 passing specs, four failing). This is not represented
as a single green full-suite invocation. After corrections, full affected-file
reruns passed: chat/scroll/citation/dock selection (39 scenarios / six files),
pane animation and responsive rails (29 / two), and touch editing plus chat
controls/scroll (16 / three). Counts overlap and are not added together.
The initial scroll failure also reproduced in isolation before its correction.
One intermediate pane rerun missed animation frames while renderer changes were
still being applied; the final unchanged pane/rail run passed all 29 scenarios.

The first native smoke run passed all 28 scenarios. A second run failed the
post-restart publication scenario with the real busy-workspace rejection. After
the readiness observation/wait, another full smoke run passed all 28. The live
Qwen pass and native smoke preceded the final touch/IME compatibility edit;
those keyboard rules were verified through the actual browser input journey.
Native helpers submit through explicit Send and native Rust was unchanged.
Driver/reconnect warnings alone are not evidence of success; assertions and
terminal outcomes determine these results.

Pinned native binary SHA-256:
`d26f807100ff8fc7b503d9c5932933e7955bbc3126e96fce83e0e54ea439c7e3`.
All native tests used generated disposable vaults and isolated app data. No
ordinary vault or running ordinary app was modified by acceptance.

Logs are retained in `/tmp/pi-combined-*.log`. Acceptance source/config/doc fingerprint
(tracked plus nonignored untracked files, excluding `.scratch/`):
`420e893f88fda68a6af09e5033ef16f1cdd6b2c7dac0c76d71d035350d011a8d`.
Only ChatPanel, the E2E-only Notepad observation and its restart helper changed
during this pass. The final fingerprint remained unchanged through verification.
Commit preparation on 2026-10-17 also removed trailing blank lines from the newly
staged scope record and provider fixture. The staged whitespace check passes;
that preparation made no behavioral change.

## Merge preparation and remaining limits

- Include the untracked rebuild implementation/tests/docs in the commit; a
  tracked-only diff is incomplete.
- Preserve the agreed new-user scope: clean chat reset, no legacy migration,
  initial read-only model tools and the native future create/update authority
  foundation. Review remains the default for that future write path.
- Keep the ordinary final manual UX pass for foreground appearance/focus and
  any device acceptance before a release. Automated desktop checks do not prove
  physical-iOS behavior or every native pointer/paint interaction.
- Do not infer lower storage, IPC or latency from source reduction. Fresh matched
  measurements are still needed for those claims.
- The branch has 94 commits after local main, including retired experiments.
  Prefer a coherent final merge description; retain historical checkpoint
  `64cc3ff6` if squashing and later removing the experimental branch.

This pass supersedes the combined-check limitation in
[the shared search/hash outcome](pi-shared-search-cleanup.md) and adds current
combined validation to [the earlier pre-merge audit](pi-premerge-audit.md).
