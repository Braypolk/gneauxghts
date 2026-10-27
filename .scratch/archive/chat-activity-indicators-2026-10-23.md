# Chat activity indicators

Completed 2026-10-23.

The note's chat switcher, conversation-history button and individual conversation
rows now display a grey pulsing dot for running work and a solid green dot for
finished, unread results. Unread results take precedence in the aggregate when
another chat is still running. The running dot pulses over three seconds with
cubic Bézier easing. Reduced motion keeps the grey dot static.

`features/chat/pi/activity.ts` owns one presentation projection per Pi Harness,
independent of pane mounts and history paging. Pi live/inbox documents establish
running work and terminal input submissions establish completed results. The
projection does not schedule, settle or abort tasks. `ChatReadDoc` persists the
largest acknowledged submission ID. Reading a loaded, expanded chat in the
foreground clears only the observed result; a delayed acknowledgement cannot
clear a newer one. Old history without an initialized marker starts read.
Explicit aborts, passive writes, forgotten chats and internal note-title jobs do
not create unread dots. Background failures remain discoverable as unread results.

Validation:

- 412 chat/component/adapter tests passed across 33 files.
- After final refinements, 18 activity/runtime tests passed, including retained
  unread/read state over Harness reopen, stale acknowledgement, delayed bootstrap,
  paginated history, queue settlement, failure, abort and forgotten/internal scopes.
- `pnpm check` passed with zero Svelte errors/warnings, including E2E type checks.
- The WDIO `chat-activity` session verified desktop switcher dots, history/row dots,
  read acknowledgement, foreground completion, dark theme and reduced motion.
  Screenshots were visually inspected. The session and owned fixture server were
  closed after export.
- Exported and reviewed `e2e/agent/specs/chat-activity.e2e.js`; all three cases passed
  on fresh replay at port 1435. Replay owned and stopped its fixture server.
- `pnpm build` passed; Vite's large-chunk warning remains.

Coverage boundary: browser verification uses the synthetic native/provider fixture
with actual Pi scheduling. Reopen persistence tests reuse Pi MemoryStorage across
Harness lifetimes; no native SQLite/window-focus or physical-device run was made.
The fixture's existing unsupported publication-owner binding message is unrelated
to these presentation checks; no publication fallback was added.

## Review — October 27, 2026

Corrected three read/observation defects before committing this feature:

- History Mode retains pane mounts under its overlay. Workspace visibility now
  participates in read admission, so a covered chat cannot acknowledge a reply.
- A newer aborted input no longer stands in for an older completion. The bounded
  activity projection retains that completion's Pi record; read admission checks
  its exact loaded answer, or its displayed answerless failure. An actual-Pi
  compaction regression verifies that loading earlier history makes the older
  answer eligible, without clearing unread while it is absent.
- Persistent switcher subscribers follow each successful runtime open, including
  an explicit attempt after failed startup and a replacement after close. No
  polling, automatic retry or scheduling owner was added.

The new runtime reconnection regression failed against the original code. The
History Mode failure was reproduced in the `remaining-review` WDIO session and
the corrected behavior verified interactively. The maintained chat replay now
includes that case. Focused activity/startup coverage also verifies answerless
failure acknowledgement and the same subscriber surviving runtime replacement.
