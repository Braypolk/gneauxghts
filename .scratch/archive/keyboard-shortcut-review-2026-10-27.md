# Keyboard shortcut review, 2026-10-27

Completed review of the shortcut registry, Settings and dispatch changes in
`57e4dbff`, the recent Thought partner split follow-up in `51c9f2fe`, and the
working-tree exact-modifier fixes. Comparison baseline: `8b5b8221`; unrelated
release-signing changes are outside this review and commit.

## Scope and outcome

The conversation supplies the acceptance criteria: expose app commands and
explicit editor commands in Settings, allow multiple bindings in one row per
action, support command/keybinding search, preserve remaps and disabled commands,
and require exact modifiers for dispatch, held split cues and search-result
split gestures. Basic native text movement and ordinary control keys are outside
this catalog at the user's request.

Independent Spec and Standards reviews found the following confirmed gaps, now
corrected:

- Restored the inherited macOS Transpose Characters command (Ctrl+T) as a
  registered, editable, removable command. Its non-macOS default is unassigned.
- Cancelled Forget keyboard holds when their modifier set changes. Both completion
  timers revalidate the assignment, recording/restart guards and action admission.
  A normal short press still opens confirmation.
- Suspended retained dock Search/Forget handlers in History, image viewing and
  publication recovery; entering those states clears a pending hold/confirmation.
- Corrected conflict scopes for global search and selected-image editor actions,
  without treating the separate image viewer as the editor.
- Preserved explicit platform assignments that happen to equal a macOS default,
  including after preference reload; reset restores the current platform default.
  Malformed persisted override metadata is ignored.
- Rejected IME processing events with keyCode 229 before isComposing is set.

The exact-modifier changes also cover search-result Enter/click alternatives,
held split previews, custom bindings and external-link Cmd/Ctrl-click gestures.
No additional actionable Spec or Standards findings remain in this scope.
The authoritative behavior is recorded in
[behavior invariants](../../docs/architecture/behavior-invariants.md#keyboard-assignments-come-from-one-command-catalog).

## Validation

- `pnpm check`: zero errors or warnings, including E2E TypeScript checking.
- Full Vitest suite: 177 files passed, one skipped; 1,784 tests passed, one skipped.
- Fresh Chrome replay: all 10 shortcut specs passed, covering 47 cases.
  Maintained cases cover the complete 16-combination click/Enter modifier matrix,
  held previews, Settings grouping/search/recording/persistence/reset, editor and
  image remaps, History and Related dispatch, and recent Thought partner splits.
- The new review regressions were exercised in the named WDIO session
  `shortcut-review-fixes`, captured, exported, reviewed and replayed. The first
  replay exposed test readiness and grouped-case time-budget issues; explicit
  mount waits and independent modifier cases corrected those harness failures.
  The final run passed without additional product changes. The session and its
  owned fixture were closed; replay cleaned up its own fixture server.

The browser fixture uses disposable in-memory IPC. Windows preference/dispatch
coverage emulates navigator.platform in Chrome; this is not a native Windows
keyboard or filesystem-persistence run. IME coverage uses processing/composition
events rather than a physical input method. Publication-owner IPC is unsupported
by this fixture, so these checks do not establish native publication recovery.
