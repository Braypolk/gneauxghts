# Narrow macOS search focus regression

Completed: 2026-10-12

## Report and cause

Repeatedly clicking from a note into search could immediately close search at
narrow widths. The report was from the native Mac app. A fresh source-built
native development app reproduced it at 417 CSS pixels; Chrome did not reproduce
the failure.

A trace of real pointer interactions showed search receiving focus, followed by
CodeMirror's deferred `DocView.enforceCursorAssoc()` calling
`Selection.collapse()` at a soft wrap boundary. macOS WebKit implicitly focused
the contenteditable editor, so search correctly handled the resulting focusout
and closed. Pointer targeting was correct; there was no intercepted overlay or
missing search click handler. The narrower layout exposed wrapped cursor
association more often.

## Correction

The pnpm patch for `@codemirror/view@6.43.1` checks `view.hasFocus` at the
selection writer, in both ESM and CommonJS distributions. Deferred measurement
must not rewrite the native selection when another control owns focus. Search
and editor focus ownership stay unchanged. See `patches/README.md` for removal
criteria when upgrading CodeMirror.

## Regression coverage

`e2e/specs/native/search-focus.spec.ts` uses the mounted native editor's real
wrapping geometry and queues a wrapped cursor measurement before transferring
focus to search in the same turn. The unpatched test failed with
`data-search-open=false`. With the patch, four repeated transfers remain open
and accept search text. A companion check preserves typing at the same wrap
boundary while the editor owns focus. The suite is part of the native smoke
lane. Native tests use isolated synthetic vaults.

## Validation

- Fresh native development binary built from the current working tree; current
  Vite frontend includes the patch. The ordinary installed Mac app was stale
  and was excluded from the diagnosis/acceptance evidence.
- Native focus regression: failed before the patch, passed afterward; both
  regression cases pass (four scheduled focus transfers and focused wrap typing).
- Real native pointer acceptance at 417 CSS pixels: eight note-to-search cycles,
  editor focus on closing search, and successful search typing after reopening.
- Existing browser search controls: 9 passed.
- `pnpm check`: no Svelte errors/warnings; E2E TypeScript check passed, including
  a final check after the last test assertion adjustment.
- Harness support checks: 33 passed. Full unit run: 1212/1213 passed, with the
  generated workspace sequence exceeding its 5-second timeout under concurrent
  validation. A four-worker full rerun had two sequence timeouts and one
  timing-sensitive link parse assertion. All three affected files then passed
  in isolation with one worker (35 tests, 4.88 seconds). No unrelated production
  code or timeout settings were changed to mask those results.
- `git diff --check` passed. Temporary search probe specs/config were removed;
  only the permanent native regression and dependency patch remain executable.
