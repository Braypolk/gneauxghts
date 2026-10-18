# Pi edited-note citation feedback — 2026-10-17

Reproduced the reported red banner through the real native chat: an authorized
agent edit committed, its final answer cited the actual read preceding that edit,
and opening the citation loaded current content successfully. The native source
comparison correctly recognized a historical read. The Notepad callback wrongly
reported the successful navigation limitation as a retained chat error, which
then appeared when returning from the note.

Successful source navigation now returns optional informational feedback to the
mounted ChatPanel. It appears as a neutral, dismissible status, clears with the
next navigation, message submission or conversation selection, and disappears
when that surface unmounts. Unavailable sources and failed navigation still
reject through the existing error path. Missing/ambiguous passage feedback uses
the same informational path. Native read receipts, permission checks, content
comparison and publication behavior remain unchanged.

## Verification

- Before the fix, the actual native edit/citation regression failed with the
  exact reported error string despite no human edit.
- **Seven native macOS editing journeys passed**, including opening the edited
  note in a sibling editor, dismissing the neutral status, clearing it on chat
  switching, and the exact single-pane note → previous chat journey. The latter
  returns to the same conversation without an error or lingering notice.
- Apply, Discard/Stop, changed-base protection, independent write permission,
  direct mode, grant scope and pending review across process restart also pass.
- **235 frontend tests passed** across 25 chat/pane integration files;
  **32 support tests passed**. Svelte diagnostics: **0 errors, 0 warnings**;
  E2E TypeScript checks and whitespace checks passed.
- The focused native historical-source regression passed, preserving honest
  historical citations and the distinction between original and current reads.

The first post-fix native run passed the error/status assertions but a test
retained a dismissed DOM element while awaiting its replacement. Re-querying
the element fixed that harness assertion; the final seven-journey run passed.
Local server fixtures required loopback access outside the sandbox. Native
restart cleanup warnings remain existing harness output. Physical-device and
live-model behavior are not claimed; the provider uses deterministic protocol
responses and all native notes are disposable fixtures.
