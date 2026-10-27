# Small-view audit — October 23, 2026

The main layouts hold together across phone and medium widths. The weakest area is reduced **height**: landscape Map, routes with the software keyboard open, and an upward-opening chat menu. Five findings were recorded. Per the user’s follow-up, landscape issues are deferred; model-dialog focus and secondary touch-target sizing are now [corrected and verified](../archive/small-view-focus-touch-2026-10-23.md). The findings and measurements below describe the original audit baseline.

Reviewed current checkout `c22589845d86598f000cc029403914b3388596d9` (initial working tree clean). This is an audit of current behavior, not a branch-diff review. Existing responsive behavior, the mobile parity plan, and the UI verification workflow supplied the expectations; no new visual design spec was provided.

## Findings and current scope

| Priority | Scope | Finding | Evidence and source | Ticket |
| --- | --- | --- | --- | --- |
| P1 | Deferred | Landscape keyboard hides Settings results and task rows. | At layout viewport 844×390 / visual viewport 844×126, Settings content begins at y=116 outside its clipped card; task rows begin at y=226. Only the searches remain usable. `src/lib/features/settings/settings.css:23–30`; `src/routes/list/+page.svelte:169–244`. | [01](issues/01-keyboard-route-content.md) |
| P2 | Deferred | Landscape Map spends almost the entire info panel on connection controls. | At 844×390, the reader is 36px high, all consumed by vertical padding. The title/excerpt disappear; scrolling reveals clipped action buttons. `src/lib/features/atlas/AtlasMap.svelte:526–546`. | [02](issues/02-short-map-reader.md) |
| P2 | Deferred | Chat Vault access opens outside the keyboard viewport. | At visual height 126, the expanded menu is 256px tall and starts at y=−181.6. All eight option centers fail pointer hit-testing. `src/lib/features/chat/ui/chatPanel.css:386–408`. | [03](issues/03-keyboard-chat-access-menu.md) |
| P2 | Fixed | Model configuration claims modal semantics but leaves focus in Settings. | Opening retains focus on Configure; Tab visits the backdrop outside the dialog, and Shift+Tab reaches background controls. `src/lib/features/settings/LocalModelSettings.svelte:161–184,340–353`. | [04 outcome](../archive/small-view-focus-touch-2026-10-23.md#modal-focus) |
| P2 | Fixed | Map and model configuration retain small touch targets. | Coarse-pointer measurements: Map arrows 30×30, Auto 34.6×23; modal close 32×32, capability switches 44×24, Save/Cancel 36px high. `AtlasMap.svelte:535,546`; `LocalModelSettings.svelte:361,421,433–436`. | [05 outcome](../archive/small-view-focus-touch-2026-10-23.md#touch-targets) |

P1 denotes a supported core workflow that becomes unusable under the reproduced condition. P2 findings are localized usability/accessibility defects. Touch sizing is a consistency finding against the app's existing 44px coarse-pointer convention, not a claimed external accessibility certification failure.

## What held up

- No page-level horizontal overflow in 48 settled baseline captures: editor, List, Map, Settings Appearance, AI & Chat, Vault, Note Timeline, and Keyboard shortcuts at 320×560, 390×844, 640×560, 768×700, 844×390, and 1024×768.
- Phone portrait and medium layouts retain clear navigation, aligned editor headers, contained bottom bars, readable task content, and scrollable Settings. Phone/landscape checks also covered Forgetting, Semantic search, and Forgotten Items.
- All **34 existing browser regressions passed**: 12 responsive layout, 3 mobile viewport, and 19 retained pane rail tests. These cover narrow calendars and formatting menus, nested tasks, title/action spacing, History, failed saves, split switching, draft/undo/selection retention, interruption/reduced motion, safe areas, and editor/composer keyboard geometry.
- No independent architectural/standards breach was established beyond the interaction and touch inconsistencies above. No refactor is proposed on code-smell grounds.

## Evidence

- [Settings with landscape keyboard](evidence/probe-settings-keyboard.png)
- [List with landscape keyboard](evidence/probe-list-keyboard.png)
- [Landscape Map reader](evidence/probe-map-landscape-final.png) and [after scrolling](evidence/probe-map-landscape-scrolled.png)
- [Chat access with landscape keyboard](evidence/probe-chat-access-keyboard-final.png)
- [Model dialog on a phone](evidence/probe-model-modal-phone.png)
- [Baseline measurements](evidence/measurements.json) and [focused probes](evidence/probe-results.json)

Generated images/measurements remain in the ignored local evidence directory. Each ticket records reproduction and expected acceptance independently of these files. The named WDIO session `small-view-audit` retained command/screenshot traces under `e2e/agent/.wdio/session/small-view-audit/`.

## Validation and limits

Used the repository's disposable browser IPC fixture, with coarse-pointer/device metrics for the visual pass, plus the existing desktop-pointer browser regressions. Keyboard probes use the same visualViewport override technique and 126px height already used in `mobile-viewport.spec.ts`; the screenshots include blank space below that synthetic visible viewport. Those blank areas represent space obscured by a real keyboard.

Command: `pnpm test:e2e:browser --spec e2e/specs/browser/responsive-layout.spec.ts --spec e2e/specs/browser/mobile-viewport.spec.ts --spec e2e/specs/browser/responsive-pane-rail.spec.ts` — 3 spec files, 34 tests passed. The fixture logged the documented unsupported publication-owner binding and some ResizeObserver warnings; this was not a warning-free run and does not validate native chat publication.

The initial capture pass was superseded because some states were recorded before responsive geometry settled; baseline captures were rerun with explicit viewport reapplication and settling. Only the settled baseline measurements support the findings above.

This does not establish real iOS/WebKit keyboard behavior, native window chrome, touch gesture feel on a physical device, native filesystem persistence, live-provider behavior, or accessibility assistive-technology acceptance. The two-note Map fixture is intentionally sparse and is not evidence about realistic vault density. The initial audit exported no new regression; the subsequent correction adds a reviewed focus/touch replay, recorded in the linked outcome.

Completed implementation: modal focus and secondary touch-target sizing, with seven new and 38 existing browser regressions passing. Landscape keyboard content access, short Map readers (including the reproduced short desktop-window case), and landscape chat access placement are deferred at the user’s request. Their evidence and original priorities remain for later reconsideration; do not treat tickets 01–03 as the active implementation queue. Completed tickets 04–05 are consolidated in the archived outcome.
