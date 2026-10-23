# Untitled capture naming — 2026-10-22

A note can remain visibly untitled while its body autosaves. Native persistence
uses `Untitled Note <Note Identity>.md` and the existing managed `untitled` marker;
reads recognize that exact identity-bound filename as a blank title. This is a
canonical Markdown note, so saving, indexing, Note Timeline and restart durability
retain their existing owners. Autosaves retain the path and identity. A collision
blocks publication without changing either existing file. A typed/generated title
uses ordinary saving to replace the capture filename and clear the marker. An
explicit filesystem rename also supplies an ordinary title.

`DocumentEditingService.finalizeTitleOnDeparture` derives an unresolved title from
the first eight words of the first nonempty body line, capped at 80 Unicode
characters. Workspace departure invokes it before saving the last editor of that
note; application navigation invokes it for the departing workspace. Reopening
the same note and an uncompleted Previous picker leave the title blank. Background
saves preserve it. Empty new drafts create no file; saved/tag-only notes without
body text use “Untitled note”. Conflicts retain the existing admission rules, and
failed departure saves retain the document and requested title for retry.
Title input now updates the shared document synchronously and schedules ordinary
autosave; the pane keeps only its raw display draft. Keyboard route navigation
still blurs the input to flush it. Departure retries newer edits made while a save
is pending and retains the document if edits continue to outpace the barrier.

The existing manual Generate title button remains available throughout blank-title
editing, including after autosave. Ordinary search, pane, Atlas and task filename
labels hide identity-bound capture names behind “Untitled note”; History lifecycle
labels also hide them. Actual paths remain available in storage diagnostics.

Validation:

- Focused frontend coverage includes autosave/departure composition, shared-editor
  deferral, same-note reopening, failed rename retention, authored-body preservation,
  application/background barriers, note labels and architecture ownership.
- Native persistence tests cover blank-title save/read, repeated autosave with
  stable path/identity, explicit naming, marker removal, collisions and warnings.
  The native library run passed 712 tests with 22 explicit diagnostics ignored;
  two loopback tests were blocked by sandbox binding permissions and passed when
  rerun with loopback access. The newly added collision test also passed.
- Five maintained untitled-capture browser regressions pass on fresh replay,
  together with the four existing manual-title regressions: application navigation
  and reopen, latest-body departure naming, focused-title keyboard navigation,
  compact typed-title precedence and compact generated-title precedence.
- Svelte/E2E type checks, production build, Rust formatting and diff checks pass.
  The existing production large-chunk advisory remains.

Desktop and 390-pixel screenshots were inspected in WDIO session
`blank-note-title`. Its reviewed export is `e2e/agent/specs/untitled-capture.e2e.js`.
The owned session/server were closed; replays stopped their own fixture server.
Browser evidence uses synthetic provider responses and memory-only IPC. Native
Rust tests exercise real disposable files and Timeline publication; the updated
native WebView regression was not replayed here. Known unsupported fixture editor
publication-owner and mark-opened commands do not establish native integration
coverage. No user-vault content or settings were changed by validation.

## Edge-case review follow-up

Fixed the three reproduced review failures: title text entered while navigation
waits for autosave now reaches the shared buffer before departure naming; ordinary
save completion no longer cancels a still-current title-generation request; and
naming/reopening preserves a matching authored first heading. Native task line
mapping, search/paragraph fixtures, semantic passages and image offsets now count
the preserved heading consistently with the editor body.

Regression tests first failed on the old behavior. The maintained browser suites
now cover typing during autosave before New Idea and Settings navigation, typing
during the fallback rename itself, generation spanning initial autosave, and typed
precedence over a released late response. All 13 title browser cases pass on fresh
replay. Setup waits for the new editor's readiness and focus before typing; one
earlier setup race was inspected via its retained failure screenshot.
Frontend coverage passed 890 tests (one explicitly skipped), plus the later
continued-edit departure regression. Svelte/E2E checks and the production build
pass. Native coverage includes exact heading/body retention through naming,
subsequent saving and reopening, and editor task lines with frontmatter and CRLF.
The native suite's old heading-stripping expectations were updated to the new
authored-body contract; connection tests ran with disposable loopback access.
These checks use synthetic model responses and disposable files, without a user
vault or live model call.

## Final departure retry correction

Pane departure and application navigation now recheck blank-title naming before
each bounded save attempt. Clearing a title while a fallback write is pending
therefore restores the first-line title; nonblank input, including a title entered
after clearing, remains authoritative. Shared-editor deferral, background saving
and continuous-edit failure retention keep their existing behavior.

Six composition cases cover cleared, whitespace-only and clear-then-type input
across both barriers. Four blank-input cases failed before the correction while
the two nonblank precedence cases passed. All pass after the fix. The broader
notepad/architecture run passes 883 tests with one explicit skip; all 14 title
browser cases pass on fresh replay, including actual typing/deletion during a held
fallback save. Svelte/E2E type checks and diff checks pass. Browser checks use the
disposable memory-only fixture; this frontend coordination correction adds no
native persistence changes.
