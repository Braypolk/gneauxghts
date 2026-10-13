# Secondary touch controls and image gestures

Implemented issue 05 from the iOS readiness plan for recent iPhones.

## Behavior

Coarse-pointer devices receive 44px minimum targets for chat controls, message actions, attachment preview/removal/download, image tools and corners, date-picker controls, Related close, History rename, and Settings key/model actions. Existing icon dimensions remain unchanged; the image corners keep their 12px marks inside transparent 44px targets. History rename and chat branching remain discoverable without hover. The API-key toggle stays inside its enlarged input field.

Inline tasks expose a visible “+ Due date” action on touch devices. Existing date chips and calendar days have taller targets. The picker retains its existing date mutation and floating-panel owners, including scrolling in landscape. Desktop hover and icon sizing remain unchanged.

The image viewer supports two-finger pinch zoom anchored to the moving finger midpoint, bounded one-finger pan while zoomed, and horizontal swipe browsing at fit. Vertical or cancelled gestures do not browse. A remaining finger after a pinch can pan without becoming a browse swipe. Pointer cancellation, lost capture, resizing, blur, backgrounding, image changes and teardown clear active gestures. Image taps retain the viewer; backdrop taps and Close dismiss it. Viewing gestures do not mutate authored Markdown.

Enlarged pending attachments reproduced a landscape-keyboard overflow. The composer now bounds its height and scrolls inside the remaining viewport, preserving attachment targets and navigation access.

## Validation

Five new mounted browser tests in `e2e/specs/browser/secondary-touch.spec.ts` pass. They cover portrait/landscape date insertion, calendar target sizes, chat and attachment actions, visible branching, Related/History/Settings controls and unchanged SVG sizes, actual browser touch pinch/pan/swipe/cancel/tap input, image browsing boundaries, closing, unmodified Markdown, and note scrolling over inline images.

The four mobile viewport regressions also pass, extended with attachment addition/removal in the 126px landscape keyboard viewport. The editor geometry assertion waits for CodeMirror's asynchronous viewport measurement rather than checking an intermediate frame. Twelve existing image interactions, nine date journeys, four control-sizing checks and seven mounted chat checks pass: 41 mounted checks in total. Six image model/widget unit tests pass. Svelte and E2E type checks and `git diff --check` pass.

The initial browser run reproduced hidden due-date insertion, undersized secondary controls and absent pinch response. Browser emulation establishes the app's pointer behavior and geometry, not WKWebView or physical iOS gesture acceptance. No new native simulator or physical-device run was performed for this issue. Repeat pinch/finger lift/pan/swipe/cancellation, tiny and large images, inline scrolling/resizing, attachment controls with the software keyboard, and date controls on recent physical iPhones under issue 08. Normal packaging, VoiceOver and text scaling remain in that gate.
