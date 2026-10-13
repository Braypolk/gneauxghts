# Compact search control motion

2026-10-12. Follow-up to the narrow Mac recording and search focus correction.

## Cause and correction

The compact search CSS switched the input layer to wrapping flex layout only
when expanded. Scope buttons moved instantly from the right of the input to the
left of a new row; match-option width animation then moved them again. Content
height also changed immediately.

The compact layout now retains one right-anchored control row. The query field
reserves the existing mode controls when idle, and its bottom margin unfolds
space above the buttons on the existing search expansion curve. The current
content measurement drives the dock background height, preserving the circle
sizes and baseline. Match options use their existing width/opacity reveal toward
the left. The mode-count CSS variable comes from the component's existing
choices; there is no parallel focus state, motion timer, or height animator.

The inner magnifier remains measurable but does not consume query-row width or
paint separately from the dock's projected glyph. This avoids changing its
measured inset when focus changes. Dock handoffs, window resizing, and reduced
motion suppress the local row transition through the existing presentation seam.

## Validation

- Mounted browser regression failed on the original jumping scope positions.
- Opening/closing frame checks cover exact compact viewport widths, height and
  background interpolation, anchored scope icons, leftward match-option reveal,
  stable circle size and magnifier position, interrupted motion, populated
  current-note search and reduced motion.
- Real native development app at 417 CSS pixels: opening 46px → 90px and closing
  90px → 46px, each with 20 intermediate height frames; both scope icons had
  zero horizontal/vertical drift. The background reached the same height and
  the magnifier remained correctly inset. Repeated real pointer reversals kept
  search focused on reopening. Only isolated synthetic notes were used.
- Existing native wrapped-cursor search focus and typing regression: 2 passed.
- Existing browser mobile transitions (6), desktop search controls (9), and
  shared workspace dock checks (21) passed with the final glyph geometry.
- Svelte/TypeScript and diff whitespace checks passed.

Final compact regression suite: 7 passed, including 393/417/530px two-row
layouts and the adjacent 680px single-row layout. Combined with the 36 existing
checks above, 43 distinct browser checks passed. The fixture waits for the
workspace's rendered resize suppression to finish before measuring deliberate
focus transitions, including after reduced-motion emulation changes. Native
probe instrumentation and its temporary server were removed/stopped after
recording the acceptance measurements.

Follow-up: the projected magnifier now fades back in with the same expansion
duration and curve as the compact bar, and disappears immediately on opening.
Its ordinary search transition previously covered
position alone, so closing snapped opacity to one. The seven mounted browser
checks now also verify immediate hiding, interpolated return opacity, reversal,
unchanged wide-layout visibility, and immediate reduced-motion visibility.
