# Related notes redesign — 2026-10-19

The drawer/bottom sheet is replaced with a floating button beside Search
which opens the existing popup in Related mode. Rows show title, section and
excerpt and use ordinary passage navigation. Editor/card width and wrapping no
longer depend on Related. The former drawer, prototype/lab command, reservation
styles, selection-scope tracking and related-only layout coordination are removed.

Popup mode stays local to the command bar, separate from search scope and the
search/chat dock machine. Source
pane/document changes and History entry dismiss the popup. Search query/scope
state remains available when returning to search.

One workspace-lived owner shares requests/results by ephemeral DocumentHandle.
Only the open popup registers demand. Edits/catalog changes reject old responses
and mark retained rows stale; Refresh/Retry changes
the list explicitly. Target notifications remove affected rows. Final release
retires the entry; native inference itself is not cancelled.

Native corrections retain existing graph/ANN/query retrieval and draft-reference
acknowledgement. Saved-source shortcuts require indexed bytes and requested
title/body to match disk, avoiding saved neighbors for changed drafts. Related
responses serialize catalog Note IDs and pass identity/path through the existing
current-content boundary. Unavailable command responses are not cached.

Implementation scope was narrower than the original optional backend ticket:
existing candidate ranking and graph/ANN first-body previews remain. No model,
index, persistence or chat-tool redesign was needed for these surfaces. A
candidate-specific passage-ranking algorithm and fresh semantic-quality/native
workflow evaluation remain outside this delivered UI change. Do not infer those
outcomes from the browser fixture.

Current ownership and invariants live in [ARCHITECTURE.md](../../ARCHITECTURE.md)
and [behavior invariants](../../docs/architecture/behavior-invariants.md).
The six planning tickets are consolidated here rather than retained as an
executable backlog.

## Validation

- `pnpm check`: Svelte and E2E type checks pass with zero diagnostics.
- `pnpm test`: 154 Vitest files, 1,322 tests pass; support tests pass.
- `pnpm build`: production static build passes.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib related`: 15 tests pass,
  including draft/index equivalence and late related-cache invalidation.
- Browser verification: all 13 affected suites pass (87 checks), across the
  broad run and focused rerun. The rerun verifies fixes for input focus loss
  while switching a typed search to Related and a button jump while compact
  pane animation temporarily removes the search bar from flex layout.

Browser fixtures verify UI/navigation mechanics, including empty-query mode,
coalescing, loading/Retry, retained search, keyboard navigation, fixed editor
bounds at desktop/phone widths, History, compact rails, chat handoffs, resize
and reduced motion. They do not
prove real semantic ranking, physical iOS/IME behavior or live embedding quality.

## Follow-up: remove the editor footer

At the user’s request, the end-of-note Related section and its CodeMirror
widget/bridge were removed. Discovery now uses only the floating button and
shared popup. The footer-specific block-handle workaround and browser test were
removed, and popup checks assert that no footer is mounted.

Validation: `pnpm check` passes with zero diagnostics; the related-store and
block-handle unit suites pass (12 tests); Related popup and editor-layout browser
suites pass (8 checks), including the absence of editor-footer chrome.

## Follow-up: exchange Search and Related icons

Search and Related now use the same active-bar/floating-icon pattern as the
Search/Chat controls: Related opens with a floating Search circle on the left,
and its icon occupies the embedded glyph position. The external Related circle
is hidden while active. Returning to Search restores its existing query, scope
and focus. The chat return control and retained composer stay independent.

Related's heading overlays the mounted Search layout rather than replacing its
sizing content. This keeps the bar width and height identical at desktop and
compact two-row breakpoints. The discovery group uses the existing dock duration
and editor curve; pane coordination measures the flex frame without applying
that separate presentation translation twice. Reduced motion skips the slide.
The incoming note's icon slot is measured before a closing chat retires; Related
stays unavailable during that handoff. This also removes a late bar-position jump
found by the wide Search/Chat continuity regression.

Validation: `pnpm check` passes with zero diagnostics; the production build and
24 related-store/dock-machine unit tests pass. Browser checks cover identical
Search/Related geometry at 390, 640, 900 and 1440px with and without retained
chat, touch sizing, History, keyboard return to Search, pane handoffs, resize
and reduced motion. All 26 shared-dock checks pass, including the last-chat
continuity regression. Pane animation checks pass across the suite and a focused
rerun of an intermediate-frame sampling assertion; that assertion missed frames
while another browser suite ran concurrently. Geometry probes now locate the
outer action row through the discovery wrapper and include the temporarily
absolute dock's painted height during pane motion.

## Follow-up: reuse the actual Search/Chat dock

The user's idle screenshot exposed a placement gap missed by the previous
focused-Search checks: Related was aligned to the toolbar's flex frame rather
than the narrower painted Search bar. The separate Related translation and icon
swap are now replaced by `WorkspaceInputDock`'s actual Search/Chat mechanism.
`related-search` and `related-input` share its poses, transition clock, joined
SVG material, circle exchange and glyph reveal. Related caps its secondary width
to Search's width and keeps Search's height throughout the exchange, including
compact two-row layouts. The shared focus boundary includes the floating Search
control; query, scope and keyboard return remain intact. A retained chat remains
directly accessible beside the active Related bar.

Changing secondary surfaces captures the painted bounds before applying the new
size constraints. Pane handoffs interpolate those bounds and reserve the outgoing
height until settling, avoiding both a width jump and a downward backdrop jump
when returning from Chat. Ordinary Search expansion moves the Related circle
alongside the bar.

Validation: `pnpm check` passes with zero diagnostics, the production build
passes, and 39 related-store/dock-machine unit tests pass. All 15 Related browser
checks pass, including idle and expanded icon adjacency at 390/640/900/1440px,
fixed bar dimensions, visible embedded glyphs, keyboard navigation and direct
return to retained Chat. The 26 shared-dock checks pass across the broad run and
focused reruns; pane-animation (10 checks) and control-sizing (4 checks) pass.
The earlier assumptions that closing Chat absorbs every secondary circle and
keeps a disabled Send glyph were updated: the resulting note now exposes an
enabled Related circle beside Search.

## Follow-up: remove Search/Related transition snaps

The user's recording showed abrupt resizing missed by the earlier settled-size
checks. A real browser frame capture reproduced a 234px width jump when opening
Related directly from idle Search. The destination secondary width cap was
applied before the shared icon exchange, and the outgoing content was hidden
or unmounted before its fade. Extending the probe to compact height exposed a
second immediate jump of roughly 44px as Search unfolded its two-row scaffold.

The dock now interpolates the actual painted width and height on its existing
motion clock. It clamps the destination width before interpolation, avoiding a
late leading-edge reversal when the available width is smaller than the requested
cap. Interrupted exchanges start from the painted dimensions. Search controls
and the Related heading stay mounted with explicit presentation opacity; inactive
contents are inert and hidden from accessibility. The heading follows the painted
body height while the invisible Search scaffold supplies the destination sizing.

Validation: all 19 Related browser checks pass, including frame-by-frame width,
height and circle-position checks at 1440px and 390px, rapid reversal, outgoing
fade and post-settling stability. All 26 existing shared-dock browser checks pass;
39 related-store/dock-machine unit tests pass. `pnpm check` reports zero errors or
warnings, and the production build passes. Intermediate desktop opening/dismissal
screenshots were inspected; the temporary capture spec was removed. Browser
fixtures verify presentation and focus, not native macOS rendering performance.

## Follow-up: match ordinary Search's curve and duration

At the user's request, Related opening/dismissal and Search/Related exchanges
now use ordinary Search expansion: 460ms with cubic-bezier(0.32, 0, 0.2, 1).
`src/lib/ui/search/searchMotion.ts` supplies both the CSS custom properties and
the dock clock, replacing the duplicated configuration. Interrupted exchanges
retain proportional remaining travel; pane changes keep their coordinated clock.
The pane adapter also understands the Search easing when sharing a live dock
transition.

Validation: 32 dock-machine unit tests and all 29 Related/pane-motion browser
checks pass. Browser frames verify the Search curve, the actual CSS duration,
continuous dimensions, reversals and fades. `pnpm check` reports zero errors or
warnings, and the production build passes.

## Follow-up: share popup components and remove delayed Related reveal

The user's report exposed remaining differences beyond the bar's curve. A real
browser capture reproduced the Related glyph reaching zero opacity and the popup
remaining clipped throughout the dock exchange. Related was fading between two
copies of Network using Chat's glyph handoff, and the shared reveal deferred all
dock popups until settling. The dock also disabled Search scope-label transitions,
making the outgoing controls jump to their expanded widths.

Related now keeps one Network glyph throughout the exchange. Its popup reveals
immediately alongside expansion, at the final layout width so excerpts do not
rewrap during motion. Scope labels keep ordinary Search's width/fade transitions.
Search and Related use `SearchResultsPanel` for the shell, reveal and styling;
Recent, Pinned and Related share `SearchResultsHeading` and `SearchNoteResult`,
with Related providing additional row detail. Content swaps retain the same
open panel. The popup heading is Related. Existing loading, stale, Refresh/Retry
and keyboard behavior remain explicit.

Existing Search checks also exposed a compact-height issue: the toolbar's grid
track could outgrow its last measured frame for one paint, moving the popup base
down by about four pixels before returning. Constraining that track to
`minmax(0, 1fr)` keeps the toolbar anchored while its observer updates. The popup
keeps its expanded layout width on dismissal as well as opening, and pane
handoffs continue preserving their captured scope-label widths.

Validation: 66 affected browser checks pass across Related (22), shared dock
(26), Search popup layout (7), scope controls (10) and pinned notes (1). New
frame checks verify continuous glyph visibility, no initial scope-control snap,
immediate popup reveal and fixed popup width at desktop/phone sizes. A content
swap check verifies that Search and Related retain the same popup DOM element
and use the common note-row component. Existing Search checks cover stationary
opening, dismissal, rapid reversal and reduced motion. All 32 dock-machine unit
tests pass; `pnpm check` reports zero errors/warnings and `pnpm build` succeeds.
Desktop/phone screenshots were inspected, and temporary layout probes were
removed. Browser checks cover the presentation path; native macOS rendering was
not replayed.

## Follow-up: reusable container presentation

The dock is now the reference implementation of
`src/lib/ui/morphing-containers/MorphingContainers.svelte`. Callers provide any
ordered list of keyed items, icon/content snippets and activation callbacks. The
component owns presentation only: `icon`, `compact` and `expanded` states,
configured or measured dimensions, shared chrome defaults, joined SVG material,
content fades and interrupted exchanges. One item presents content at a time;
the remaining items use their circular presentation. The feature adapter retains
Search queries/scope, Related retrieval/focus and mounted Chat draft ownership.

Search, Related and Chat all use that renderer. The old workspace-specific
machine and surface/material components are removed. Every container exchange
uses the original Chat/Search 380ms compress/exchange/unfold pinch clock. This
supersedes the earlier Search/Related-only 460ms curve described above. Pane
changes can coordinate their layout clock and measured destination without
easing icon travel twice. New item keys reuse retiring physical slots during a
pane-kind change, preserving foreground/background alignment.

The common Search/Related popup is supplied through the renderer's overlay,
outside inert or fading content. Related reveals during expansion; changing its
heading, notes and row detail retains the popup. Phone layouts anchor the panel
to its expanded base while the containers pinch. Related has no editor footer
or workspace width reservation.

Search's scope and match-option widths follow the shared body's painted width
during ordinary expansion/collapse, avoiding CSS/frame-clock drift. Populated
Search retains its label layout while inactive in Chat. Popup dismissal positions
are measured against the shared overlay owner rather than the bordered input.

Validation: 37 shared motion unit tests pass, including arbitrary two/three/five
item orders, pairwise transitions, third-item interruption, stale frames,
dimensions, dynamic item replacement and coordinated geometry. Across the full
and focused runs, 77 browser checks pass: shared dock (26), Related (23), phone
transitions (5), Search popup (7), scope controls (10), pinned notes (1) and Chat
reading position (5). `pnpm check` reports zero errors/warnings and
`pnpm build` succeeds. Native outline test selectors were migrated to the shared
material; this refactor has not been replayed in native WebKit or on physical iOS.

## Follow-up: native WebKit transition verification (2026-10-20)

Built the current debug E2E binary and exercised the actual macOS WebKit window
against an isolated temporary vault. The native dock outline spec now seeds a
saved source note, compares Chat/Search with Search/Related at 1440px and 417px,
and samples committed frames within WebKit. It checks the original 380ms pinch
clock/curve, joined neck, continuous Related glyph, immediate popup reveal,
fixed popup width/base, unchanged editor text bounds, retained popup DOM and
rapid reversal. Screenshots are captured separately from timing measurements.

One complete native run passed both tests. Across six Related openings, p95
frame intervals were 17–18ms, versus 18ms for Chat/Search; maximum gaps were
18–21ms, versus 18–27ms for the baseline. Material/geometry and popup anchor
assertions passed within 1px. Desktop and narrow screenshots were inspected.
An earlier first opening had a 72ms frame gap; it did not recur in that complete
comparison. Subsequent fresh-session repeats lost actual window visibility or
focus during sampling and are invalid measurements, not additional passes.
The test rejects hidden-window samples and distinguishes native window focus
from WebKit document focus during content handoffs. No production animation
changes were justified by the valid native evidence.

The temporary vault's semantic index was unavailable/warming, so native Related
paint verification covers that popup state, not populated excerpts or semantic
ranking. Populated rows retain the earlier browser coverage. This check does
not establish physical iOS behavior. `pnpm check:e2e` and `git diff --check` pass.
