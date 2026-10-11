# Dates and task deadlines

Use `/date` or `/today` to insert today's local date, `/time` for local hour/minute, or `/now` for both. Commands work after whitespace in a sentence or a task. Select the command and press Enter; Escape leaves what you typed. Code and links do not offer date commands. Insertions are fixed ordinary Markdown text, using your system locale and timezone, Gregorian dates, and Latin digits.

When the caret leaves matching date/time text, it keeps the surrounding text style with a faint dotted underline. Click it to select the date/time in the note and type directly over it. Typing dismisses the picker and saves as an ordinary note edit; Undo restores the previous text. To choose from the calendar or time control instead, select a value below and click Apply. The popup has no separate date textbox for these inline edits. The picker opens beside the text, follows scrolling and resizing, and adjusts its placement near screen or pane edges without dimming the background. Escape, Cancel, or a click outside dismisses it without applying pending calendar/time choices. An outside click also places the caret or activates the clicked control immediately; no second click is needed. The calendar supports keyboard navigation and month/year dropdowns. Browsing months or years changes only the displayed calendar until you pick a day and Apply. The time control supports typing and selecting/spinning hours and minutes. Text matching the current locale's insertion format is also editable this way. Recognition and picker values follow the current locale; changing locale does not rewrite stored text. Older or imported numeric dates retain no authoring locale, so ambiguous text such as `03/04/2026` can acquire a different picker interpretation after a locale change.

For a task deadline, type `/due` on its checkbox line, use its Add due date control, or click an existing due date. The same picker is available in the master task list. Deadlines are date-only and live in the note:

```markdown
- [ ] Send the proposal due @due(2026-10-02)
  - [ ] Check the figures due @due(2026-10-01)
```

Each task owns its date. Parent dates do not propagate to children, and inserting ordinary date text in a task does not set a deadline. No creation dates are automatically stamped or inferred.

Adding a deadline inserts the word `due` as ordinary note text before the annotation, unless the task already ends with `due`. You can change that word to `by`, `deadline`, or any other wording, or delete it. Later date edits preserve your wording and the date's position. The date control displays only the date or relative label, with “Overdue” for late open tasks. Existing deadlines and ordinary dates are not rewritten. Removing a deadline clears its annotation and keeps the surrounding authored wording for you to edit.

Click an existing deadline in the note to select just its `YYYY-MM-DD` date for direct typing, keeping `@due(` and `)` intact. The calendar opens beside it while keyboard focus stays in the note, with no separate popup date textbox. Typing dismisses the calendar and saves as an ordinary note edit; Undo restores the previous date. You can also choose a calendar day or preset and click Apply, or use Remove due date. Cancel, Escape, and outside clicks discard pending calendar choices. Adding a new deadline and editing from the master task list still use the popup's date textbox.

The picker accepts ISO dates, Today, Tomorrow, Next week, full English weekday names, and `in N days` (0–365). Next week means seven calendar days from today. A weekday means its next occurrence, including today. The resolved date is shown before Apply. Cancel changes nothing; cancelling `/due` leaves the typed token in the note.

Use Remove due date to clear a deadline. The first valid `@due(YYYY-MM-DD)` is effective. Explicit edits update that annotation in place and remove valid duplicates; removal clears valid duplicates. Invalid, escaped, inline-code, and link annotations remain text. Four-digit Gregorian dates from 0001–9999 are supported. Editing outside Gneauxghts, reloading, or moving a note keeps deadlines portable.

Reference-link labels are preserved, even when their definitions are elsewhere in the note. Code spans or links that remain open on the task line are protected conservatively; close them on that line before adding a deadline with the picker. Date edits preserve trailing spaces used for Markdown line breaks.

The master list combines its existing completion and hidden filters with:

| Date filter | Membership |
| --- | --- |
| All dates | Current completion/hidden view |
| Overdue | Open tasks dated before local today |
| Today | Tasks dated today |
| Upcoming | Tasks dated after today |
| No due date | Tasks without a valid annotation |

Default note grouping and Markdown order remain unchanged. Sort by due date sorts within each note, ascending, with undated tasks last. Completed tasks never appear as actionable overdue work. Labels and filters refresh at local midnight and when the app resumes, without changing your Markdown.

## Chat

Chat messages and retries include current locale, date order, hour format, and
timezone context. Current note passages can carry parsed checkbox/deadline
metadata. Assistant and note-research guidance instructs the model to compare
`@due` dates with local today, keep child dates separate, and distinguish completed
tasks from actionable overdue work and plain date text. This is model guidance,
not a guarantee that every request reads task lines or interprets them correctly.
Date edits are prepared as proposals for your review.

Current settings do not establish how older or imported numeric dates were
written. Chat should ask when such dates are ambiguous. Note activity during a
period and task deadlines during that period require different evidence; editing
a note last week does not make its tasks due last week.
