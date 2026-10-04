# Intermittent cursor and search investigation

Progress: Investigation complete. Search corrected; cursor failure unproven.

## Search: confirmed stale-focus race, corrected

A deterministic headless reproduction held the real `open_note` IPC response
while Beta navigation was pending. WebDriver then reopened search and entered
Alpha. Alpha results existed and search held focus. Releasing Beta loaded the
note but called the editor's focus method, closing Alpha's result panel while
leaving the query intact. `search-before.log` preserves the focus trace and failed
assertion. `search-after.log` preserves the passing same reproduction after the
initial correction.

This establishes a real application bug consistent with the original symptom;
it cannot prove what happened in the earlier uninstrumented headed run.

Delayed workspace presentation now yields automatic focus to newer pointer,
keyboard, text-input, wheel, or window-blur activity. Search/task/link targeting
keeps that same interaction check through note loading and subsequent paint;
otherwise a body match could refocus later even after the workspace declined to.
Note loading, saving, pane ownership and document adoption still complete normally.
Programmatic focus alone is deliberately not treated as new user interaction:
normal editor focus during navigation must not cancel its own section targeting.

The short-lived listeners are removed on cancellation or completion. Workspace
operation listeners also end on disposal/supersession. A component-local abort
signal releases the post-open flow listeners on route disposal even when IPC is
still pending. Independent review identified this cleanup gap in the first fix;
it is now closed (`search-review.md`). Arbitrary same-route programmatic
supersession is not a new general cancellation guarantee.

Retained regressions: one browser case in the existing editor-readiness spec
checks the actual delayed-open/new-search sequence; two openFlow cases check new
input during load and paint; one checks listener cleanup before blocked IPC
settles on workspace disposal. Existing ordinary navigation tests remain controls.
No new test module, retries, assertion removals or timeout increases were added.

## Cursor: not reproduced; no speculative correction

All 12 existing cursor cases passed in each of three bounded headless diagnostic
runs (36 cases). All 27 wrapped-fixture records matched the exact authored
CodeMirror document, with no missing diagnostic view. The trace observed native
selection, actual model selection and real updates, preserving original input,
geometry assertions and timeouts. Detailed observer/update histories would be
emitted only on failure. Instrumentation adds CPU work and can affect timing, so
these passes do not prove the old race fixed. The earlier headed `Wnrapped`
content mutation remains unexplained; no user-interference cause is assumed.

The common `Wrapped text` fixture predicate cannot alone distinguish successive
fixtures. This is a latent test-readiness weakness, but it did not cause a
mismatch in these observations and does not justify changing selection behavior
to get green runs. See `cursor-review.md` for narrowed hypotheses and the next
trace interpretation if a real failure recurs.

All temporary live cursor instrumentation has been removed and the source is
byte-identical to the input spec. The already retained DOM range-bounds fix from
pre-merge validation remains. We stopped after the planned three runs.

## Validation and handoff

- Controlled search reproduction: failed before correction, passed afterward.
- Traced cursor run 1 also passed both readiness cases and all five original
  formatting cases; subsequent two runs were cursor-only.
- Full frontend: 1,069 cases in 143 files passed; support: 32 passed.
- Svelte/TypeScript/E2E checks: zero errors and zero Svelte warnings.
- Frontend production build passed; changed-file whitespace checks passed.
- Full final uninstrumented headless browser suite: 26 files, 110 cases passed
  in 2m43s (`browser-final.log`). No added retries. Dates still logs its recovered
  intercepted-click diagnostic; this is not a claim of warning-free output.
- No native/visible application launched. No Rust code changed.
- The first unprivileged support run could not bind loopback sockets (EPERM);
  the permitted run passed. Logs preserve both outcomes.

`navigation/focusIntent.ts` is a required new source file; include it with the
working-tree changes when committing. No merge, staging, commit or push occurred.
