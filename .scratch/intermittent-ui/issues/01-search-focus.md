# Delayed navigation steals focus from a newer search

Status: ready-for-agent
Progress: Complete. Controlled browser reproduction failed before and passed after; final full headless suite, frontend/support and typechecks passed. See ../results.md and ../search-review.md.

A controlled headless browser reproduction pauses the real open_note IPC promise,
then uses WebDriver to focus search and type Alpha while Beta navigation remains
pending. Alpha results are visible and search is focused before releasing Beta.
After release, Beta becomes ready; focus moves to cm-content and Alpha results
close, while the Alpha input value stays intact. search-before.log preserves the
focus-call trace and assertion failure.

This proves a production stale-focus bug consistent with the prior screenshot;
it does not prove the cause of that uninstrumented first failure. Workspace
focusAfterPresentation checks operation and active pane identity but never whether
the user has interacted elsewhere since the command began. Section targeting in
openFlow can also perform a later focus/scroll after paint and needs the same
user-intent condition, otherwise only title results would be repaired.

Correction scope: a short-lived interaction guard around delayed navigation
focus and result targeting. New pointer/keyboard/input/wheel activity or leaving
the window cancels the old automatic focus/scroll, without cancelling the note
load/save or altering document ownership. Capture-phase listeners must not consume
the event that started the navigation, and all listeners must be removed on
success, failure, supersession or disposal. No timers or global retained owner.
