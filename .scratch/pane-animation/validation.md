# Pane animation: findings, implementation, and validation

Date: 2026-09-22. Implemented; see [scope and acceptance criteria](spec.md).

## Causes and corrections

The original pane jerkiness reproduced at roughly 60 fps, without long tasks.
Parent-scoped Svelte styles did not reach the pane component, opening had no
entrance state, and independently animated outer/card widths plus Related
reservation updates produced overshoot and a second settling movement.

Pane resting/collapsed styles now live in `NotepadPane.svelte`. A presentation
helper measures geometry at transition boundaries and coordinates pane widths,
outer sizes, card margins, Related position, and opacity with one 220 ms curve.
Close waits for completion or cancellation, with a bounded fallback. Workspace
membership, save ordering, document references, and editor identity retain their
existing owners. Active borders live inside their pane and follow its bounds.
Related/card/History transitions share tokens and honor reduced motion.

Populated chat had two additional costs: synchronous native conversation reads
on the IPC/UI thread and mounting all Markdown messages at once. The read now
uses the existing application worker. Restored history mounts eight messages
per frame and remains hidden/inert until complete and positioned. Known chat
splits create chat directly, retaining source context and its editor return
route without a placeholder editor. Previous resolves availability inside its
guarded command transition; missing targets leave the picker open.

Editor chrome suppresses unchanged inset writes. Chat's initial correction,
anchor navigation, and streaming follow share one cancellable scheduled write;
explicit navigation takes priority and respects reduced motion. A corresponding
unchanged tag-height optimization remains with the separate uncommitted tags
feature and is not included in the standalone animation commit.

## Measured evidence

Chrome 153, requested 1440×1000 window, synthetic 80-paragraph note; native
samples use a disposable Tauri/WebKit debug fixture. Values are observations,
not performance guarantees.

| Reproduction | Before | After |
| --- | --- | --- |
| Editor split width | 986 → 493 px snap, overshoot ~684 px | Continuous 986 → 667 px |
| Close survivor width | Doubles when the pane is removed | Continuous 667 → 986 px |
| Activate original pane during entrance | 9 misaligned border frames; ~698 px maximum error | 0 misaligned frames; 0 px error |
| Inset writes during editor split | 28 identical 64 px writes | 1 initial write for the new editor |
| Related with actual Chromium reduced motion | Four 300 ms transitions | No running animations |
| Direct chat split | Temporary editor mount | No new editor; original retained; no unchanged inset writes |
| Native restored chat, 100 messages | 334–358 ms maximum gaps even after frontend batching | 37–53 ms after worker dispatch |
| Chrome 100-message mount | 187 ms maximum gap, 183 ms long task | 34.5 ms maximum gap after batching; no reported long tasks |

The final native chat check measured 39 ms and 36 ms maximum gaps. The second
round retained foreground focus throughout; the first lost focus during sampling.
The isolated Related probe measured 18.1 ms; a concurrent test/probe run reached
124.5 ms and is excluded from isolated performance comparisons.

## Verification

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- Focused frontend suite: 140 tests across 18 files pass, including pane/navigation
  lifecycle, commands, inset writes, chat scrolling/controller, architecture.
- Browser pane motion, populated chat, and document/pane suites: 31 tests pass.
- Two tag layout/scrolling checks pass in the combined working tree; those belong
  to the separate tags feature.
- Six Rust chat-command tests passed when the native worker change was made.
- Native populated chat: two successful open/close rounds with all 100 messages,
  correct initial scroll, and gaps below the fixture's 150 ms severe-stall limit.
- Native editor/editor: geometry, editor identity, and cleanup pass. The first
  implementation had a fully focused passing run; the latest run and isolated
  retry fail the final foreground-focus assertion. Do not report the latest
  complete native editor spec as passing.
- Both native specs in one invocation caused the second to fail fixture-title
  setup before sampling. Run them separately for fresh temporary vaults.
- `git diff --check`: passes.

Durable regressions live in `e2e/specs/{browser,native}/pane-animation.spec.ts`,
`chat-pane-animation.spec.ts`, and the focused frontend tests. See
[the E2E guide](../../e2e/README.md#pane-animation) for execution instructions.
One-off probe scripts and raw JSON traces were removed after consolidating their
findings here. Avoid writing artifacts into the Vite-watched tree during tests;
run browser/native servers sequentially because they generate shared SvelteKit
files. Native measurements require an unlocked, foreground test window.

## Commit isolation check

Before committing, the staged files were exported to a temporary snapshot without
unrelated working-tree changes. SvelteKit sync, Svelte/TypeScript and E2E type
checks passed using the installed tools; all 140 focused tests and 31 browser
journeys passed again in that snapshot. Raw logs and the separate tags/timeline
work were excluded from the commit.

## Remaining profiling

Live text still reflows during width animation. Profile large wrapped notes,
tables/code/images, expensive individual Markdown messages, backdrop-blur paint
cost, and actual mobile keyboard motion before changing the rendering strategy.
These small fixtures do not establish native GPU cost, a universal 60 fps budget,
or the performance of unusually large messages. No fixed-width clipped surface
or editor snapshot was introduced.
