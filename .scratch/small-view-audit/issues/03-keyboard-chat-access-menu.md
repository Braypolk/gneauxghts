# Constrain chat Vault access to the visible keyboard viewport

Status: needs-triage
Disposition: deferred — user requested leaving landscape issues out of current scope.
Priority: P2
Type: task

## Reproduction

At 844×390 with coarse pointer, open Thought partner, focus Message, override visualViewport height to 126, dispatch resize, then open Vault access. The button is expanded but the 256px menu starts at y=−181.6. None of its eight option centers passes `elementFromPoint` hit testing. The fixed upward placement has no available-height calculation; content is clipped by surrounding dock geometry.

Sources: `src/lib/features/chat/ui/chatPanel.css:386–408` and `src/lib/features/chat/ChatPanel.svelte:195–217`. The existing positioned Write folder permissions panel is a useful established placement pattern to inspect.

## Acceptance

- The open access menu fits the current visual viewport or offers a usable alternative when vertical room is insufficient.
- Every read/write option remains reachable by pointer/touch and keyboard, with scrolling and correct selected states.
- Keyboard opening/dismissal and viewport rotation reposition an already open menu safely.
- Preserve ordinary portrait/desktop appearance and authority-policy semantics.

See [audit](../report.md) and [screenshot](../evidence/probe-chat-access-keyboard-final.png).
