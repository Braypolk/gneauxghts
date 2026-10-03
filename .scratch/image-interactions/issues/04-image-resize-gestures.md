# Make image resizing commit once and cancel safely

Status: resolved
Type: task
Depends on: 02, 03

## Scope

Replace window-listener-only resize handling with a view-owned gesture controller, pointer capture, mapped target reference, and initiating document/runtime lifetime. Follow [the specification](../spec.md) for proportional preview, size clamping, shared transaction commit, no-op detection, and history isolation. Reuse source-preserving width commands for keyboard sizing and gesture completion.

## Main files

- `images/imageEmbedWidgets.ts`
- Private `imageResizeController.ts` and image commands.
- Existing shared-runtime transaction forwarding, only if necessary to preserve supported history annotations.

## Acceptance

- Pointermove modifies only the initiating pane's preview and schedules editor measurement, without saving or updating note Markdown.
- Pointerup creates one undo action and one shared content change at a currently valid mapped range.
- Escape, pointercancel, lost capture, widget detach, note navigation, and runtime replacement restore authoritative appearance and release handlers.
- Sibling-pane edits during a gesture cannot retarget it; unsafe changes cancel.
- Pointerup after cancellation is inert. Repeated keyboard sizing forms an isolated burst; subsequent typing/gestures undo separately.
- Browser geometry tests verify aspect ratio, surrounding layout, and stable scroll anchoring; native checks cover WebKit capture behavior.

## Comments

Preserve authored sizes larger than a narrow pane; presentation clamping must not rewrite content.

## Answer

Implemented proportional four-corner preview, available-column clamping, pointer capture, and cancellation on Escape/cancel/lost capture/blur/doc changes/reconfiguration/destruction. Pointer release emits one source-preserving isolated edit; no-op widths emit none. The existing document undo root groups repeated keyboard sizes separately from adjacent typing. Browser drag/cancel/undo and native WebKit listener journeys pass.

Evidence: [implementation validation](../validation.md).
