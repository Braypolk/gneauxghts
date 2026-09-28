# Antinote: features inside notes

Research date: 2026-09-27. Scope: documented editor capabilities, with note-management features separated below. Checked the official homepage, feature index, manual topics, release index, and extension catalog; this is documentation research, not an installed-app test. The latest listed release is 2.1.3 (September 16, 2026). [Releases](https://antinote.io/updates)

## Native in-note features

| Feature | What it does | Primary source |
| --- | --- | --- |
| Inline contextual arithmetic | Evaluates expressions alongside descriptive prose; append `=`. Supports arithmetic, parentheses, powers, percentages, factorials, roots, logarithms, ceiling and floor. | [Math](https://antinote.io/user-manual/math) |
| Reactive variables | Name values or expressions, including names with spaces; dependent answers update when inputs change. Includes variable autocomplete. | [Math](https://antinote.io/user-manual/math) |
| Answer chaining | `ans` reuses the nearest calculated answer above the current line. | [Math](https://antinote.io/user-manual/math) |
| Currency conversion | Fiat and cryptocurrency conversion; configurable default currencies, custom rates, daily rate updates. | [Math](https://antinote.io/user-manual/math) |
| Unit conversion | Distance, area, volume, mass, and temperature conversions. | [Math](https://antinote.io/user-manual/math) |
| Numeric presentation | Configurable precision and thousands separators; decimal-comma locales supported. | [Math](https://antinote.io/user-manual/math) |
| Sum mode | `sum` totals numbers in a note, ignoring surrounding punctuation/symbols. | [Sum](https://antinote.io/user-manual/sum) |
| Average mode | `avg` calculates the mean of numbers in the note. | [Average](https://antinote.io/user-manual/average) |
| Counting and readability | `count` reports items, lines, words, characters, reading ease and grade level. Nonempty lines after the first count as items. | [Count](https://antinote.io/user-manual/count) |
| Whole-note list mode | `list` makes nonempty lines checklist items; a default bullet or numbered style can be chosen. Optional title; customizable typed check trigger, such as `/x`. | [List](https://antinote.io/user-manual/list) |
| Inline checkboxes | Add checked or unchecked boxes within an ordinary note using textual markers. | [Checklists](https://antinote.io/user-manual/checklists) |
| Bulleted and numbered lists | Marker recognition, automatic continuation and renumbering, arbitrary starting numbers, and keyboard switching between marker types. | [Checklists](https://antinote.io/user-manual/checklists) |
| Nested lists | Tab/Shift-Tab indent and outdent; nested numbered lists display letters and Roman numerals. | [Checklists](https://antinote.io/user-manual/checklists) |
| Completed-item handling | Checked items can stay, move to their group's bottom, or disappear. Keyboard toggling supported. | [Checklists](https://antinote.io/user-manual/checklists) |
| Basic Markdown | Three heading levels, bold, italic, underline, and strikethrough. | [Markdown](https://antinote.io/user-manual/simple-markdown) |
| Commented lines | `//` excludes lines from calculations, counting and checklists; keyboard toggle supports multiple lines. | [Markdown](https://antinote.io/user-manual/simple-markdown), [Count](https://antinote.io/user-manual/count) |
| Formatting shortcuts | Toggle formatting around a selection or cursor word; cycle headings; remap shortcuts. | [Formatting](https://antinote.io/user-manual/formatting-shortcuts) |
| Line movement | Move current/selected lines vertically with keyboard shortcuts; fenced code blocks move together; each move is undoable. | [Formatting](https://antinote.io/user-manual/formatting-shortcuts) |
| Code notes and code blocks | `code: py` selects language highlighting; default language and light/dark highlighting themes configurable. Code notes preserve indents and disable hyperlink processing. Fenced blocks and backtick text are also recognized. | [Code](https://antinote.io/user-manual/code), [Formatting](https://antinote.io/user-manual/formatting-shortcuts), [Copy](https://antinote.io/user-manual/copy) |
| Smart URLs | Visually shortens URLs while retaining the original; expand/edit, open in browser, distinguish duplicates. Disabled inside code notes/blocks. | [Links](https://antinote.io/user-manual/link-shortening) |
| Paste cleanup | Strip styling, bullets, numbering, whitespace; optionally strip Markdown and blank lines. Paste-as-is bypass available. | [Paste](https://antinote.io/user-manual/paste) |
| Context-sensitive copying | Copy whole note without selecting; copy code block/backtick content; click calculation result to copy. Options omit keywords/list markers or reset copied checkboxes. Shortened URLs copy in full. | [Copy](https://antinote.io/user-manual/copy) |
| Screenshot/image OCR | Drag or paste an image to extract editable text through macOS OCR. | [OCR](https://antinote.io/user-manual/screenshot-to-text) |
| AutoPaste | Collect subsequent clipboard text automatically into the note; choose separators; toggle off by command, Escape, or icon. | [AutoPaste](https://antinote.io/user-manual/autopaste) |
| Find and replace | Search/edit the current note: contains, whole-word, line-start, line-end, regex, and case-sensitive matching; replace one/all. | [Find and replace](https://antinote.io/user-manual/find-and-replace) |
| Stopwatch | Start an elapsed-time timer from a line. | [Timers](https://antinote.io/user-manual/timer) |
| Countdown | Count down a duration or to a clock time, optionally named. | [Timers](https://antinote.io/user-manual/timer) |
| Pomodoro | Standard or custom work/rest intervals. | [Timers](https://antinote.io/user-manual/timer) |
| Timer controls and alerts | Pause/resume/restart/stop; notification, full-screen alert, sound, volume, and menu-bar time options. | [Timers](https://antinote.io/user-manual/timer) |
| Keyword palette and aliases | First-line modes: `list`, `math`, `sum`, `avg`, `count`, `code`; optional titles; customizable aliases; `/` palette for choosing/switching modes. | [Keywords](https://antinote.io/user-manual/keywords) |

Math limitations: conversion expressions cannot be directly combined with arithmetic on the same line; conversion variables retain the numeric value without units. Space-separated thousands are unsupported. [Math](https://antinote.io/user-manual/math)

List-mode limitations: math/conversions do not run in whole-note lists. Headings and comments can interrupt the automatic list. [List](https://antinote.io/user-manual/list)

## Extension features

Optional JavaScript commands run through `::`, with autocomplete, parameters and aliases. They insert content, transform lines/documents, or open URLs. Network/AI integrations require configuration. [Extensions](https://antinote.io/extensions)

Catalog command inventory (prefix each with `::`):

| Category | Commands |
| --- | --- |
| AI | ai, polish, translate, create_list |
| Dates | today, tomorrow, yesterday, business_day |
| Random | random_number, random_letters, random_quote, random_wiki, roll |
| Text | replace, append, prepend, uppercase, lowercase, sentence_case, title_case, capitalize_first, remove_quotes |
| Lines | uppercase_line, lowercase_line, sentence_case_line, title_case_line, camel_case, snake_case, kebab_case, remove_quotes_line, remove_all_whitespace, trim_whitespace |
| Sorting | sort_lines_alpha, sort_lines_number, sort_lines_number_last, sort_lines_reverse |
| Filtering | remove_lines_with, remove_lines_without, remove_lines_empty, keep_lines_with, keep_lines_without, trim_each_whitespace, remove_each_after, remove_each_before, keep_between, remove_between, dedupe_lines, get_dupes |
| Lists | commas_to_list, commas_to, lines_to_commas, lines_to, checked_to_bottom, remove_checked |
| JSON | csv_to_json, json_format, json_sort, json_sort_array, json_filter, json_filter_out, json_add_key, json_remove_key, json_set_key, json_append_key, json_prepend_key, json_get_dupes, json_dedupe, json_get, json_set |
| Regex | regex_remove, regex_keep, regex_insert |
| Finance | loan, mortgage, investment, pv, fv_simple, fv, pmt, npv, irr, fire_amount, fire_plan, tax |
| Business | growth, forecast, cac, ab_test, sample_size, retention_churn, ltv, arpu, arppu, runway, saas_pricing |
| Templates | todo, bullet, sorry, reflect, standup, one_on_one, custom_template_1 through custom_template_10 |

Source: [official extension catalog](https://antinote.io/extensions). This inventory covers commands explicitly listed there; installed availability depends on extensions. User-created extensions make the complete possible feature set open-ended.

## Adjacent features beyond note content

- Swipe navigation and a temporary-note stack; persistent slotted notes and split screen.
- Search across notes, list/card views, dragging to reorder, multi-selection, and filtering by note space.
- Export to text, Markdown, PDF, Apple Notes, Obsidian and Bear.
- Local storage, automatic expiration/backups, recoverable deleted notes (“The Void”), optional iCloud sync.
- Themes, paper styles, text size and translucent windows.
- Global hotkey, always-on-top window, dock/menu modes, URL-scheme automation, Raycast and Alfred integrations.

Source: [manual index](https://antinote.io/user-manual). These are deliberately separate from editor functionality.

## Documentation caveats

- The feature page describes code support as minimal and points elsewhere for syntax highlighting; the more specific code manual explicitly documents language highlighting. This inventory follows the detailed manual. [Feature page](https://antinote.io/features), [Code manual](https://antinote.io/user-manual/code)
- Several manual pages retain “Updated for v2.0” labels while documenting later additions. Use the live descriptions and release chronology together. [Releases](https://antinote.io/updates)
- OCR means image-to-text capture; these sources do not establish image attachments, drawing, tables, or full LaTeX rendering. “Inline math” here means evaluated calculations.
