# iOS landscape safe areas and keyboard viewport

Implemented against recent iPhones; desktop/phone sync and older-device compatibility remain deferred. This consolidates completed implementation issues 09 and 10. Standard packaging and physical-device acceptance remain in [release gate 08](../mobile-ios-readiness/issues/08-ios-device-release-gate.md).

## Safe areas

The simulator reproduced Settings extending beneath the landscape Dynamic Island. The app shell now owns all four safe-area insets. Its content and dock share the bottom inset once; compact navigation and the mobile title slot respect horizontal insets. Full-screen image controls, attachment previews, model configuration dialogs and shared floating panels also account for cutouts. Short touch landscape windows use compact navigation while desktop mouse layouts retain their existing breakpoints.

## Keyboard viewport

Measured WKWebView geometry with the landscape software keyboard: the layout viewport was 874×402, the visual viewport 874×126, with offsetTop and document scrollY both zero. The old shell retained 402px height and lifted its dock by 276px inside the route below navigation, causing overlap. This was a vertical sizing problem independent of horizontal safe areas.

The touch shell now follows visual viewport height and panning offset. Docks do not subtract keyboard height again. Keyboard detection compares current layout and visual viewports rather than a historical maximum, including mounting with the keyboard already visible and rotation. Root viewport measurements also bound portalled dialogs and are removed/restored with the action's listeners on teardown.

With the landscape keyboard open, the workspace title row yields space to a shared 44px navigation/action row. The dock uses 46px, the chat composer places text and tools alongside each other, and Related moves beside the header actions. The normal title, spacing and composer return after dismissal or portrait rotation. The editor includes the dock in its keyboard scroll margins and keeps the focused caret visible when geometry changes, without altering text or selection.

## Verification

- Four mounted Chrome regressions pass: both landscape edges across Settings/List/Map/Gneauxght; model picker/configuration bounds; image and attachment preview bounds; 126px keyboard layout, typing at the end of a long note, keyboard reopening, route return, portrait rotation, dismissal and retained unsent draft.
- All 46 existing responsive layout, navigation, editor route, control-sizing and image-interaction regressions pass. An initial new attachment test incorrectly pasted a non-image file into an image-only paste handler; it was corrected to use the mounted file-input change path and passes.
- Four viewport unit tests and the existing editor-chrome measurement test pass. Svelte/E2E checks report zero errors and warnings; diff whitespace check passes.
- iPhone 17 Pro simulator on iOS 26.1: Settings clears the landscape Dynamic Island; editor keyboard controls and a text line remain visible on both landscape edges; return from Settings recovers usable editor focus; chat text, tools and send stay above the landscape keyboard; rotation to upright portrait and keyboard dismissal preserve the unsent `Test` draft. No message was sent.

Native observations used the existing temporary smoke package (native checkout c9b8a990) with the current working-tree frontend on port 1438. The temporary icon/launch-screen substitutions, runtime mismatch and lifecycle-test limitations are documented in [simulator validation](../mobile-ios-readiness/simulator-validation.md). No standard package or physical iPhone was validated. Browser keyboard geometry is simulated, not an OS keyboard. Recheck IME/selection, accessibility/text scaling, attachments and real interruptions through the device release gate.
