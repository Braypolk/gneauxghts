# Background native app testing

Completed: 2026-10-14

## Outcome

Native E2E executables start without activating macOS by default, including
direct launches and process-plugin restarts. The feature-only startup policy
prevents activation, disables native window focus, orders the test window behind
other windows and disables background WebKit scheduling throttling. Ordinary
application builds retain their existing startup behavior.

Background E2E capabilities omit native `set_focus`; only explicit
`GNEAUXGHTS_E2E_FOREGROUND=1` grants that permission. The lifecycle regression
attempts the denied command through actual native WebDriver. Background WDIO
scenarios also assert native window focus remains false after each test.
Artifact admission rejects older E2E binaries without the background-policy
marker, requiring their rebuild before launch.

The default smoke lane contains lifecycle, command/event transport, images and
chat-to-note. Search focus, pane/chat/dock paint and the History/Editing Window
journeys that assert restored editor focus are retained in an explicit foreground
lane. Dedicated foreground specs, measurements and first-visible-window/scale
probes reject before app launch without the flag. The shared service checks
WDIO's resolved CLI specs, not the original config glob. See
[E2E instructions](../../e2e/README.md).

## Verification

- Final debug E2E build passed, SHA256
  `a233163e955ed17e1c4c8b319724078f6b3beac74550fd53e1d508a1cec2c42b`.
- `node e2e/support/nativeSuite.mjs smoke`: all four files passed, 14 cases;
  the foreground-only painted block-cursor case was explicitly skipped.
  Chat-to-note covered actual restarts, review switching, selection, source
  navigation, retained block links and saved-note survival after chat deletion.
- `pnpm test:support`: 38 passed, including real CLI admission failures before
  launch and rejection of old unprotected E2E executables.
- `pnpm check:e2e` and ordinary non-E2E `cargo check --manifest-path
  src-tauri/Cargo.toml --lib` passed.
- `pnpm test:build:artifacts`: the repeated macOS build/test artifact check passed.
- Independent read-only NSWorkspace probes sampled the frontmost application
  every 5 ms for 45 seconds across native launch/restart experiments. No probe
  recorded the test app in front; the final probe collected 8,990 samples.
  This sampling does not establish that a shorter-than-5-ms transition is
  impossible. Final smoke cases independently passed the native focus checks.

## Limits and retained checks

Native WebKit reported hidden visibility and suspended animation frames during
background runs. Disabling inactive scheduling did not make native paint
assertions valid. The painted block-cursor assertion is a separate, visibly
skipped case in background chat-to-note; it remains enabled in foreground mode
before chat deletion. The background journey still opens the correct source,
verifies the exact durable block target through production resolution and checks
the saved file. No fake focus, animation frames or product navigation changes
were introduced.

Foreground checks were not run during this change because the user requested an
uninterrupted desktop. Run them in an available separate desktop session or with
explicit permission to interrupt; do not automatically set the foreground flag.
Live provider, release process-interruption/scale workloads and non-macOS native
presentation were not rerun. This record does not claim those gates passed.
