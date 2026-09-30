# Date functionality

## Intent and ownership
Fixed inline date/time text and explicit per-task deadlines for a quiet, keyboard-first Markdown notes app. Markdown is authoritative. Existing task recognition timestamps remain internal; no authored creation dates are inferred, added, or displayed. Existing explicit created annotations remain untouched. No schema migration or hidden deadline store is needed: the task projection already retains task Markdown text.

## Inline commands
`/date` and `/today` insert the current local date using the system locale's short date format. `/time` inserts local hour/minute (system 12/24-hour convention). `/now` inserts the same date and time separated by a space. Resolve at confirmation, as fixed ordinary text, using Intl with the system locale/timezone, Gregorian calendar and Latin digits; no settings or reactive values.

A single empty caret selection can trigger after a line start or whitespace. The token is `/` followed by ASCII letters, ends at the caret, and must end before whitespace, punctuation, or end of line; never inside a larger word/path. Markdown syntax tree excludes code, links/URLs, images, and HTML. Inline contexts offer insert actions only; existing block actions remain available for a command occupying a complete line and programmatic block menus. `/due` is available only on checkbox task marker lines. Enter or pointer selection invokes the selected item. Escape, blur, outside click, nonletters, movement out of the token, or nonempty selection dismisses without changing text; Escape suppresses reopening at that token until the caret leaves it. Only the token is replaced; surrounding text remains byte-for-byte. Date insertion is one isolated undo step.

## Editable ordinary date/time chips (user-added scope)
The user requested clicking both inserted date/time chips and due-date chips to type or select a new value, starting from shadcn Svelte. Use the existing shadcn Svelte Button and Bits UI Calendar with a modal focus boundary. Date/time insertions still persist fixed plain text, with no hidden authoring metadata. Recognize only strictly valid date/time text in the current system locale's insertion format (Gregorian calendar, Latin digits); matching manually typed text is also editable. Code, links, annotation arguments and embedded/path text are excluded. `/now` combines date and time in one chip; `/date` and `/time` expose just their respective fields. A locale change can leave earlier locale text as ordinary editable Markdown rather than guessing its meaning. Picking changes only the exact text range in one undo step. The time control accepts minute precision by typing or selecting/spinning; date text shortcuts and the calendar resolve visibly before Apply. These are wall-clock values, so selecting a DST-gap time does not silently reschedule it. Cancellation edits nothing.

## Due dates and portable syntax
Use `@due(YYYY-MM-DD)` at a whitespace boundary in a task's marker line. No existing task-date convention was found. This syntax is compact, readable outside the app, and unambiguous. Gregorian calendar dates use four-digit years 0001–9999, with strict day/month/leap-year validation; no time or UTC conversion. Inline code/link destinations and escaped annotations are ignored. The first valid annotation wins; later valid duplicates remain visible text until an explicit date edit removes all supported valid annotations and writes one canonical suffix. Invalid/unsupported annotations remain ordinary recoverable text and are never deleted by date controls. Removal removes only valid supported annotations. No date inheritance: each nested task owns its own marker-line annotation. Inserting a plain date does not set a deadline.

The note displays an understated chip for the effective annotation when its syntax is not being edited. Clicking it opens the picker. Task contextual controls offer Add due date, and the task's slash/block menu offers `/due`. The task list shows the same chip and add/edit control. Editing writes through CodeMirror's shared document runtime for editor actions and through the existing TaskMutationService/open-document gateway for task-list actions. Closed-note actions use NoteTimeline history. Dirty-note actions retain hash/revision checks, ordinary saves, and shared undo. No changes to persistence admission or conflict policy.

## Picker
A compact modal date picker with keyboard focus containment, Escape/cancel, calendar input, and explicit confirmation. Presets show their actual resolved dates: Today, Tomorrow, Next week (seven local calendar days from today, including DST transitions). Text shortcuts accept ISO date, today, tomorrow, next week, full English weekday names (next occurrence, including today), or `in N days` (0–365). All shortcuts resolve visibly before confirmation; no fuzzy parsing. Remove due date is available for dated tasks. Cancellation preserves Markdown, including a typed `/due` token. Modal editor changes retain an exact document snapshot and reject concurrent changes instead of applying a stale target; user can cancel and reopen. Task-list changes use existing task identities and reject ambiguous dirty targets.

Marker-line parsing conservatively protects bracketed reference labels and code/link spans that may close on a continuation line. Adding a canonical suffix while a code or link span is still open fails visibly rather than writing a date inside protected text. Date edits preserve trailing hardbreak whitespace. The task-list page closes its picker when the route unmounts.

## Master list
Date filters compose with Open/Completed/All, hidden controls, note grouping, and search. All dates preserves the current default order. Overdue means an open task with due < local today; Today means due = today; Upcoming means due > today, with no upper bound; No due date means no valid annotation. Completed tasks can appear in Today/Upcoming when Completed/All is selected but never in actionable Overdue. Optional Due date sorting is stable within each existing note group, ascending, undated last; default remains Markdown order. No cross-note regrouping or date propagation.

Relative labels and membership refresh at the next local midnight and on focus/visibility resume. Calendar arithmetic uses local year/month/day rather than 24-hour milliseconds. Refresh never edits Markdown.

## Acceptance and validation
- Controlled clocks/local zones verify fixed insertion, year rollover, leap years, DST day arithmetic and midnight scheduling.
- Real CodeMirror tests verify inline/task insertion, surrounding text, undo/redo, code/URL exclusions, block commands and dismissal.
- Shared parser fixtures cover valid, malformed, escaped, code/link, duplicate annotations and nested tasks; Rust canonical transformations agree with frontend parsing.
- Date actions preserve explicit created text, unrelated Markdown, CRLF, trailing newline, and child deadlines. Task identity survives deadline edits, reload/external refresh and moves via existing reconciliation.
- Dirty gateway tests cover due payload forwarding, hash/revision retry, shared undo, conflict and ambiguity handling; backend tests cover prepared nonwriting and canonical history paths.
- Combined date/completion/search/hidden filters preserve default grouping and counts; completed tasks never appear overdue.
- Browser interaction verifies slash insertion, cancellation, presets, shortcuts/calendar confirmation, chip reopening and undo, plus task-list interactions where supported by harness.
- Run focused tests, frontend type checks/build, Rust tests and architecture fitness checks. Record environmental limits honestly.

## Exclusions
Automatic creation dates, due times, reminders, recurrence, rescheduling, broad natural language scheduling, math/conversions/variables, OCR, AutoPaste, templates, statistics, timers and unrelated cleanup. Do not merge or publish.
