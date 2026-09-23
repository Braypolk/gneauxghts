# Settings redesign research

Date: 2026-09-22

## Scope

Replace the settings presentation while retaining all current actions, persistence behavior, diagnostics, and recovery tools. Add search across settings. This note records primary-source guidance and the design decisions inferred from it; it does not propose changing settings ownership or backend behavior.

## Primary-source findings

- **Apple HIG — settings:** choose useful defaults, avoid overwhelming people with settings, and keep access where people expect it, including Command-Comma on keyboard-driven platforms. Task-specific options should remain near their task. Here, “minimize settings” should mean reducing presentation overhead because the user explicitly requires preserving functionality. [Apple: Settings](https://developer.apple.com/design/human-interface-guidelines/settings). The search index exposed the guidance; the directly opened page requires JavaScript.
- **VS Code — discoverable settings:** its settings editor combines category navigation with a search field that filters settings. It supports a clear-search action and links to individual settings. This is a useful first-party precedent for both browsing and direct lookup without learning the information architecture. Immediate application is its default, but that should not override this app’s existing staged forms. [VS Code: User and workspace settings](https://code.visualstudio.com/docs/configure/settings#_settings-editor).
- **IBM Carbon — control semantics:** toggles fit a single binary option that applies immediately. Settings with several possible values, or changes needing a submission action, should use other controls. [Carbon: Toggle usage](https://carbondesignsystem.com/components/toggle/usage/).
- **W3C — accessible switches:** use an accessible label, convey the current on/off state, and support Space. The label remains stable when the state changes. Use native inputs where practical. [WAI-ARIA APG: Switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/).
- **GOV.UK — exclusive choices:** use a radio group for one selection from several choices, associate it with a fieldset/legend, and add concise hints only when needed to explain the choice. Its advice against preselection concerns question forms; existing saved preferences should remain selected here. [GOV.UK: Radios](https://design-system.service.gov.uk/components/radios/).

## Fit with this app

Repository observations: `src/app.css` defines a monochrome light/dark palette, Geist typography, subtle neutral borders, foreground contrast for emphasis, and 44px mobile control targets. Existing settings have a large rounded outer surface, General/Forgotten Items pills, a second category rail, and many repeated rounded containers. The redesign can preserve the app’s palette and control vocabulary while removing that visual nesting.

Recommended direction, inferred from the sources and local UI:

1. Use one shallow navigation level: Appearance, Keyboard shortcuts, Forgetting, Vault, History, AI & Chat, Semantic search, and Forgotten items. Give everyday preferences priority; retain maintenance and recovery actions in their existing categories.
2. Place a clearly labelled Search settings field above the content. Search all categories, not just the active category. Match control/action titles, descriptions, category names, and familiar aliases such as “trash”, “font”, “API key”, “backup”, and “embeddings”. Searching “API key” must reveal the relevant control or a direct route to it, not merely a generic AI category.
3. Present search results with their category context and a clear way to clear the query. Use an explicit no-results state. Keep focus predictable when a result opens its setting; do not make typing move focus. Do not include credential values in search data.
4. Use a quiet rail and an open content column, section headings, concise help text, and divided setting rows. Reserve substantial cards for meaningful previews or grouped diagnostic content. Align labels consistently and place their controls alongside them when space permits.
5. Retain existing immediate preference updates. Keep explicit Save/apply actions and restart notices for vault/provider forms where they already exist; do not claim everything saves automatically.
6. Keep visible keyboard focus, associated labels, radio legends, and descriptive action names. On narrow screens, stack controls and replace the rail with compact category navigation while retaining the search field and minimum touch targets.

## Verification targets

- Browse every previous category/action; confirm none disappeared.
- Search for a setting title, a synonym, several words, and an unmatched query; verify clear-search recovery.
- Verify actual preference changes and saved values after revisiting settings.
- Check light and dark modes, desktop and mobile widths, keyboard navigation, and focus visibility.
- Retain errors, disabled/loading states, destructive-action confirmations, and staged-save/restart messages.
