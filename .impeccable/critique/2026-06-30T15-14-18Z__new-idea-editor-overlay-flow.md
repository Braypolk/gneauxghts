---
target: new idea flow when there is an overlay on the editor
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-06-30T15-14-18Z
slug: new-idea-editor-overlay-flow
---
Method: dual-agent (A: 019f1915-4cb6-7443-8711-48759418c02f · B: 019f1915-7d14-7fa0-93e0-f04f88960340)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The picker is visible, but it is not clear that the editor is already ready for typing. |
| 2 | Match System / Real World | 2 | A blank note should behave like paper; the picker makes it feel like a setup step. |
| 3 | User Control and Freedom | 3 | Typing dismisses the picker, but Escape/dismissal is not obvious from the UI. |
| 4 | Consistency and Standards | 2 | The start flow reuses split-pane picker patterns for a different, lighter moment. |
| 5 | Error Prevention | 3 | Disabled previous-note state and fall-through typing help prevent misfires. |
| 6 | Recognition Rather Than Recall | 3 | Options are visible and numbered, but the visible choice competes with direct writing. |
| 7 | Flexibility and Efficiency | 2 | Keyboard-first path exists technically; the visual design still nudges users to stop and decide. |
| 8 | Aesthetic and Minimalist Design | 3 | Visually restrained, but there are too many layers over an empty note. |
| 9 | Error Recovery | 2 | Recovery from surprise is implicit: type to dismiss. |
| 10 | Help and Documentation | 2 | The placeholder helps, but the flow still needs interpretation. |
| **Total** | | **24/40** | **Needs focused redesign** |

## Anti-Patterns Verdict

**LLM assessment**: This does not look AI-generated in the usual decorative sense. It is monochrome, quiet, and avoids AI-forward badges, gradients, or marketing copy. The product-slop risk is different: the flow turns a writing moment into a decision surface. For a personal Markdown notebook, the most damaging excess is not visual noise; it is decision noise.

**Deterministic scan**: The official detector returned `[]` for `NotepadPane.svelte` and `SplitPaneContentPicker.svelte`. A CSS-only scan of `editor.css` found pre-existing warnings around blockquote/drop-indicator styling and radius values; these are not the core start-flow issue. Assessment B also identified manual overflow evidence: `.notepad-editor-shell` and CodeMirror’s `.cm-scroller` both participate in scrolling, and start mode currently works by locking both with `.notepad-editor-shell--start-open`.

**Visual overlays**: Browser visualization did not succeed. The isolated browser evidence pass could not connect to `localhost:1420`, so no reliable user-visible detector overlay was injected.

## Overall Impression

The flow is trying to be both “blank editor, start typing” and “choose how this note should start.” Those are different interaction promises. The placeholder now points in the right direction, but the visible picker still makes the note feel temporarily claimed by app chrome rather than by the user.

## What's Working

- The editor placeholder is now the right primitive. “Start typing here.” belongs inside CodeMirror, not in a separate overlay.
- The flow is visually restrained. It avoids modal onboarding, large empty-state illustration, AI-branded context, and Notion-like workspace chrome.
- The implementation protects fast capture at the event level: normal typing dismisses start mode and falls through to the editor.

## Priority Issues

**[P1] The new-note moment still asks before it writes**

**Why it matters**: The primary user is trying to capture a thought quickly. The current picker says “choose” at the exact moment the product should say “write.” This undermines the quiet, fast, keyboard-first promise.

**Fix**: Make typing the only default state. Remove “Keep writing” as an option. If recent context is needed, reveal it as a secondary affordance below the first line, after a short delay, on arrow/down, or through a subtle “recent context” row that is not selected by default.

**Suggested command**: `/impeccable onboard`

**[P1] The flow uses a split-pane picker model for a writing-state problem**

**Why it matters**: “Choose pane content” is a configuration decision. “New Idea” is a capture decision. Reusing the same listbox component leaks the heavier split-pane mental model into the blank-note state.

**Fix**: Split the interaction design. Keep shared lower-level choice logic if useful, but make the start affordance its own component or CodeMirror extension. It should feel like editor adornment, not pane configuration.

**Suggested command**: `/impeccable shape`

**[P1] Two scroll owners make the start state fragile**

**Why it matters**: The user sees two scrollbars when the overlay is active. That is a trust-breaker in a notes app because the blank page feels mechanically unstable before any writing has happened.

**Fix**: Decide on a single scroll owner. Prefer CodeMirror’s `.cm-scroller` as the editor scroll surface and remove outer `.notepad-editor-shell` vertical scrolling, or invert it deliberately and disable CodeMirror internal scrolling. Avoid start-state CSS that patches both scroll containers with `overflow: hidden`.

**Suggested command**: `/impeccable harden`

**[P2] The visible choices imply the editor is not the primary surface**

**Why it matters**: Even with the placeholder in the editor, the option list visually occupies the first thought-space. Users may pause to parse choices instead of typing.

**Fix**: Treat the options as contextual recall, not primary action. Put only “Previous note” or “Recent context” below the caret area; do not show “Keep writing” or “New note.” The blank note itself is already the new note.

**Suggested command**: `/impeccable distill`

**[P2] Keyboard behavior is hidden rather than self-evident**

**Why it matters**: Power users benefit from the typing fall-through, but first-time users see numbered options and may assume they must use the picker.

**Fix**: If the picker remains, make the first visible state less command-menu-like. Avoid selected-row styling and listbox framing until the user explicitly interacts with the suggestions via arrow/tab/pointer.

**Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Rapid Capture User**: Presses New Idea to catch a sentence. The picker steals attention, even if it does not technically steal typing. High risk of “why is this asking me something?”

**Keyboard-Native Markdown User**: The numbered options over the editor read like a command palette embedded in the note. The expected model is caret-first, optional commands second.

**Local-First Trust User**: “Previous note” appearing before the first keystroke may feel like the app is trying to be clever. Context recall is useful, but it should not make the blank page feel less private or immediate.

## Minor Observations

- The placeholder is a strong improvement and should remain editor-native.
- The top title overlay plus start affordance creates stacked chrome over the empty note.
- Locking scroll during start mode fixes a symptom but makes the editor feel slightly disabled.
- “New note” is redundant after New Idea already created a new note.

## Questions to Consider

- What if `New Idea` simply created a blank note and focused the caret, with no visible picker until the user presses ArrowDown or pauses?
- Is “Previous note” part of starting a new idea, or is it a recents/navigation affordance that belongs in the bottom bar?
- Should the user ever visually notice the start picker if they immediately type?
- What would this look like as a CodeMirror widget below the first empty line instead of an absolute Svelte overlay?
