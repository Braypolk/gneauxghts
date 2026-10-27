# Small-view modal focus and touch controls — completed October 23, 2026

Completed findings 04–05 from the [small-view audit](../small-view-audit/report.md). The user deferred landscape findings 01–03; they remain outside this correction.

## Modal focus

The model capability editor previously left focus on Configure and allowed Tab/Shift+Tab into background Settings. It now uses the repository's native `dialog.showModal()` pattern, moves focus to close, makes the background inert, wraps Tab in both directions, and restores the initiating Configure control after Escape, Cancel, close, backdrop dismissal and successful save. Configure is retained explicitly for browsers where pointer activation does not focus buttons. Backdrop pointerdown prevents a default focus change from undoing restoration. The card retains its visible-viewport sizing and internal scroll.

Owner: `src/lib/features/settings/LocalModelSettings.svelte`. Existing delayed-request Settings tests now dismiss the modal before changing its background provider; they still verify stale capability results after component disposal.

## Touch targets

The measured defects were Map arrows at 30×30px, Auto at 34.6×23px, model close at 32×32px, capability switches at 44×24px, and Save/Cancel at 36px high. These controls and Configure now use at least 44×44px targets for coarse pointers. The switch's visible track remains 44×24px within a transparent enlarged button. Map reader actions and region naming/navigation buttons use the same coarse-pointer minimum. Fine-pointer dimensions retain their existing compact layout.

Owners: `LocalModelSettings.svelte`, `src/lib/features/atlas/AtlasMap.svelte`; shared convention: `src/app.css` `.coarse-touch-target`. SVG Map node hit areas were a static follow-up candidate, not one of the measured defects or part of this correction.

## Verification

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript check passed.
- `pnpm agent:test --spec ./specs/model-dialog-touch.e2e.js`: **7 passed** in a fresh fixture/browser replay. Reviewed export from the owned `modal-touch-fixes` session; tests independently reset state and use relative URLs.
- `pnpm test:e2e:browser --spec e2e/specs/browser/settings.spec.ts --spec e2e/specs/browser/chat-controls.spec.ts --spec e2e/specs/browser/responsive-layout.spec.ts`: **38 passed** (19 Settings, 7 chat controls, 12 responsive layout).
- Focus entry, forward/backward cycling, programmatic background focus rejection and all five dismissal paths passed. Coarse targets and outer switch hit-area activation passed at 390×844 and 320×844. Map arrows cycle filtered notes and Auto resets manual strength. A 320×560 portrait dialog scrolls to Video/Save, saves the change and retains it after reopening. Fine-pointer control sizes were checked separately.
- Inspected dialog screenshots at both phone widths and short portrait height, plus the Map reader. Selected local comparison evidence remains in [audit evidence](../small-view-audit/evidence/): `fixed-model-dialog-320.png`, `fixed-model-dialog-390.png`, `fixed-model-dialog-320-short.png`, `fixed-map-reader-touch.png`.
- Named interactive session closed and owned fixture server stopped; replay runners cleaned up their servers.

The first replay exposed test setup assumptions: the reset endpoint has no app viewport metadata, so phone metrics are now applied after loading an app route; a fine-pointer Map arrow can flex narrower than its nominal 30px width, so the regression checks its unchanged 30px height. No production correction was needed for those replay failures. Earlier interactive failures informed the explicit Tab wrap and backdrop pointer handling; the trace remains under ignored `e2e/agent/.wdio/session/modal-touch-fixes/`.

These are Chromium frontend/fixture checks, with emulated coarse pointer and device metrics. Physical touch feel and real iOS/WebKit focus behavior were not established. Existing browser suites logged the known unsupported chat publication-owner command and a ResizeObserver warning; they do not establish native chat publication or backend persistence. The native/backend paths were not changed.

## Review — October 27, 2026

The Tab handler used `Element.checkVisibility()` unconditionally. Reproducing
with that API absent raised a TypeError before focus wrapping. It now uses
element geometry and computed visibility, and the maintained replay checks both
Tab directions and focus restoration with the API removed. All eight model/touch
cases passed on a fresh browser fixture. The `remaining-review` WDIO session
retains the initial error and corrected interactive assertions.

The existing responsive calendar test also raced the compact-navigation mount
immediately after resizing to 320px. It now waits for the visible Switch tab
control before asking the navigation helper to open List. No product navigation
or deferred landscape behavior changed.
