# Dates and task deadlines

Use `/date` or `/today` to insert today's local date, `/time` for local hour/minute, or `/now` for both. Commands work after whitespace in a sentence or a task. Select the command and press Enter; Escape leaves what you typed. Code and links do not offer date commands. Insertions are fixed ordinary Markdown text, using your system locale and timezone, Gregorian dates, and Latin digits.

When the caret leaves matching date/time text, it appears as a small chip. Click the chip to type or select a new date/time, then Apply. The calendar supports keyboard navigation; the time control supports typing and selecting/spinning hours and minutes. Text matching the current locale's insertion format is also editable this way. After changing locale, older text may remain plain Markdown; it is never silently reinterpreted or reformatted.

For a task deadline, type `/due` on its checkbox line, use its Add due date control, or click an existing due chip. The same picker is available in the master task list. Deadlines are date-only and live in the note:

```markdown
- [ ] Send the proposal @due(2026-10-02)
  - [ ] Check the figures @due(2026-10-01)
```

Each task owns its date. Parent dates do not propagate to children, and inserting ordinary date text in a task does not set a deadline. No creation dates are automatically stamped or inferred.

The picker accepts ISO dates, Today, Tomorrow, Next week, full English weekday names, and `in N days` (0–365). Next week means seven calendar days from today. A weekday means its next occurrence, including today. The resolved date is shown before Apply. Cancel changes nothing; cancelling `/due` leaves the typed token in the note.

Use Remove due date to clear a deadline. The first valid `@due(YYYY-MM-DD)` is effective. Explicit edits consolidate valid duplicates into one suffix; removal clears valid duplicates. Invalid, escaped, inline-code, and link annotations remain text. Four-digit Gregorian dates from 0001–9999 are supported. Editing outside Gneauxghts, reloading, or moving a note keeps deadlines portable.

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
