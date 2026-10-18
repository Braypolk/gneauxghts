# Pi create/edit adapter cleanup — 2026-10-17

Completed the two requested cleanups without changing native publication,
authority validation, or the shared publication task phases.

- Creation now uses Pi's validated execution-checkpoint arguments directly. It
  no longer reads or writes a candidate memo. The computed edit candidate remains
  memoized before native preparation, so recovery cannot rerun replacements
  against changed canonical bytes.
- The stable native request ID and atomic publication-child/review handoff remain
  in place. A recovered tool with an existing child waits for that same child.
- Reviews are a discriminated union: edit has a patch; create has destination and
  full authored Markdown. Creation has no empty patch or optional nested creation
  payload, and the UI only computes diff presentation for edit reviews.
- Pi's review document upgrade preserves currently retained review content and
  decisions across the shape change. There is one current consumer representation;
  no task-input, citation, authority, or old-chat compatibility layer was added.

Verification:

- All 309 chat tests in 24 files pass, including new interrupted-prepare recovery
  checks for both operations. They verify identical request IDs/payloads after
  reopening, no creation memo, retained edit staging, and one publication.
- Stored review conversion preserves content and decisions across reopening,
  mutation, and a second reopening. Existing pending review, fork, Stop,
  lost-acknowledgement, exact approval, and read-backed citation tests pass.
- `pnpm check` passes with zero Svelte errors/warnings and passing E2E types.
- All 15 macOS creation/edit journeys pass using the existing pinned E2E binary
  and current frontend: five creation checks and ten editing checks. These include
  real process restarts, one retained creation after two restarts, one edit after
  pending-review recovery, exact review display, explicit permissions, revocation,
  destination collisions, discard/Stop and read-backed citations.

Desktop acceptance uses deterministic providers and generated disposable vaults;
it does not establish live-model behavior. No new iOS acceptance was performed.

Logs: `/private/tmp/pi-mutation-cleanup-chat.log`,
`/private/tmp/pi-mutation-cleanup-check.log`, and
`/private/tmp/pi-mutation-cleanup-native.log`.
