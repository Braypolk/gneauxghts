# Obsidian style image interaction plan

Prepared October 2, 2026. This is an investigation and proposed implementation plan; application code has not been changed.

## Recommendation

Replace the current image interaction and widget implementation while retaining CodeMirror, the shared document runtime, canonical Markdown, the save queue, and Note Timeline ownership. The recording's experience depends on separating **rendered image selection**, **source editing**, and **large image viewing**. Adding a viewer alone would leave the main editing differences unresolved.

The proposed feature includes local image rendering for wiki embeds and standard Markdown images, selection through keyboard navigation, contextual controls, source editing with a retained image preview, keyboard and pointer resizing, image deletion/copy/cut, and a modal viewer with document-wide navigation, zoom, and pan. Existing embeds need no bulk conversion or migration.

## Evidence and limits

Primary evidence is the supplied [screen recording](</Users/bray.polkinghorne/Desktop/Screen Recording 2026-09-02 at 2.00.38 PM.mov>). It is approximately 65.5 seconds long, 3024 by 1964 pixels, and includes another video playing inside the screen recording. The timestamps below refer to the supplied file, starting at its beginning, rather than the inner player's progress bar. Initial playback setup occupies about seven seconds, and the demonstration finishes around 60 seconds.

I inspected one frame per second throughout the recording, then inspected four frames per second around deletion, undo, keyboard sizing, pointer resizing, and source editing. Some key overlays remain visible after the triggering event. Times are therefore approximate; screenshots establish the visible results, not every hidden click, exact pixel increment, or internal implementation.

Obsidian's [July 30 release notes](https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4/) independently document image keyboard selection, delete/copy/cut, `+`/`-` resizing, `0` size reset, `Enter` editing, and `Tab` size editing. These documented additions are labeled separately below. They fill gaps without claiming they were all demonstrated in the recording.

The recording visibly exposes a **standard Markdown** image with a size in its label: `![Citrus|200](20220530163503%20Citrus.png)`. The first recipe image's exact Markdown is not exposed. Wiki embeds are a current Gneauxghts capability that the plan preserves.

## Recording walkthrough

| Supplied recording time | What happens | What it establishes |
| --- | --- | --- |
| 00:00–00:07 | A recipe note is visible; playback and system controls appear before the demonstration starts. | These controls belong to the recording/playback environment, not image functionality to implement. |
| 00:07–00:11 | The note scrolls through ingredient text and several instruction photographs, then returns to the leading photograph. Hovering reveals small controls in the image's upper-right corner. | Images remain in document flow. Contextual controls appear near the image without exposing its Markdown. |
| 00:11–00:14 | The leading photograph opens in a dark viewer. The image fills the available area while preserving its proportions. A filename appears above it and a close control at the upper right. | A large viewer opens over the existing note; it does not navigate to another note. |
| 00:14–00:16 | Right-arrow key overlays accompany successive instruction photographs. | The viewer navigates multiple images from the same note, including images outside the current editor viewport. |
| 00:16–00:18 | Escape closes the viewer and returns to the recipe note. A rendered image has an outline and a magnifier cursor while remaining visible. | Viewer dismissal restores the editor context. A selected rendered image is distinct from editable Markdown. |
| 00:18–00:21 | Backspace removes the complete image; surrounding content moves upward. A brief Command-Z overlay appears and the photograph returns. | Delete acts on the embed as a unit, and ordinary undo restores it. The video does not show deletion of the underlying asset file. |
| 00:21–00:23 | Right-arrow navigation selects the image with an outline while leaving the picture rendered. | Keyboard selection does not automatically reveal the filename or source. |
| 00:23–00:27 | Repeated `-` presses shrink the selected image; `=` key overlays accompany growth. Text below the image moves as its displayed height changes. | Keyboard sizing operates on the image's layout in the note and preserves its apparent aspect ratio. The unshifted `=` key acts as a growth shortcut in this recording. |
| 00:27–00:30 | The cursor moves onto the bottom-right corner, becomes a diagonal resize cursor, and drags outward. The image grows smoothly. | A corner gesture previews proportional resizing without entering source mode. |
| 00:30–00:35 | A linked Citrus note opens. Its illustration is rendered; right-arrow overlays accompany image selection. | The same selection behavior applies to a different image and note. Navigation to that note is ordinary note navigation, not an image-gallery feature. |
| 00:35–00:39 | Space opens the selected Citrus image in the large viewer. Repeated `=` presses enlarge it until only part of the image fits. | A selected image has a keyboard viewer shortcut. Viewer zoom changes inspection scale independently of the image's note layout. |
| 00:39–00:44 | A hand cursor drags the enlarged illustration around, exposing different text and fruit details. | The viewer supports two-dimensional panning while zoomed. |
| 00:44–00:48 | Escape returns to the note and the illustration remains selected. Enter reveals an editable Markdown line above the still-visible image. | Source mode retains an image preview; it is not a swap that makes the image disappear. |
| 00:48–00:54 | The source is `![Citrus](20220530163503%20Citrus.png)`. Left-arrow movement places the caret in the label; adding `|200` makes the picture small. Subsequent up/down/right navigation hides source again and selects the rendered image. | The source is standard Markdown, preserves its label and encoded filename, and updates the preview while editing. The typed `0` overlay here is part of entering `200`, not evidence of a size-reset shortcut. |
| 00:54–00:57 | `=` enlarges the selected small image in steps. | Keyboard resizing works after an explicit source width has been set. |
| 00:57–00:60 | Enter exposes the source again, now showing `Citrus|400`. Arrow navigation leaves it and source becomes concealed while the resized picture remains. | Visual sizing is represented in authored Markdown. The manually entered width evolves from 200 to 400 during the demonstrated growth sequence. |
| 00:60–00:65.5 | The inner player stops at the final editor view. | No additional image behavior is demonstrated. |

## Function inventory

### Rendered images and selection

1. Pictures participate in normal note layout between paragraphs and headings.
2. Hover reveals a compact upper-right toolbar with a magnifier and a source/edit icon.
3. An image can remain rendered while selected; a visible outline communicates selection.
4. Arrow navigation can reach that selected state without exposing Markdown.
5. The magnifier cursor indicates inspection/opening; the bottom-right corner has a resize cursor.
6. Backspace removes one whole embed. Command-Z restores it. Asset-file deletion is not demonstrated.
7. Selecting an image and editing its source are different operations. The exact mouse-selection gesture is not fully established; direct image activation visibly opens the viewer.

### Note layout sizing

8. `-` shrinks the selected rendered image.
9. `=` grows it in the recorded keyboard layout. Support both `+` and unmodified `=` in Gneauxghts.
10. Pointer dragging at the bottom-right corner changes the displayed width continuously.
11. Width changes preserve the apparent aspect ratio and reposition following content.
12. Changes are stored in the Markdown size, rather than existing only in DOM styles.
13. Source entry accepts a precise width, visibly 200 pixels, while preserving the preview. After keyboard growth, the source visibly contains 400.
14. The recording does not establish the exact per-key width step, min/max sizes, history grouping for repeated keys, or pointer-cancel behavior.

### Viewer

15. Image activation opens a large dark overlay with filename and close control.
16. It initially shows the whole image at a useful fit while retaining proportions.
17. Right arrow advances through images embedded in the current note. The viewer is not limited to mounted widgets.
18. Space opens the selected image from the editor.
19. `=` enlarges the image in the viewer.
20. A hand cursor and dragging pan the enlarged image horizontally and vertically.
21. Escape dismisses the viewer and returns to the existing note position and image selection.
22. The recording does not demonstrate previous-image navigation, gallery wraparound, wheel/pinch gestures, click-to-toggle zoom, or viewer reset. These need explicit proposed defaults below.

### Source and documented parity

23. Enter changes a selected image to source-editing mode; Markdown appears above its rendered preview.
24. Source edits update image size without opening a separate settings dialog.
25. Moving the caret away conceals source again.
26. The image label and percent-encoded destination survive changes.
27. Supplementary documented parity: Delete also removes the embed; Cmd/Ctrl-C copies it; Cmd/Ctrl-X cuts it; `0` resets note-layout size; Tab targets manual size editing. These actions are in the official release notes, not all visibly exercised here.

No cropping, rotation, image annotation, external-file launching, upload picker, operating-system image import, drag-to-reorder, or asset destruction is demonstrated. Existing generic block reordering may still apply; it should be regression-tested rather than advertised as a newly copied behavior.

## Current implementation

| Concern | Current code and behavior | Implication |
| --- | --- | --- |
| Syntax | `images/imageEmbedParser.ts` scans `![[...]]` with a regex. It accepts PNG/JPEG/GIF/WebP/SVG/AVIF/BMP targets and width, width×height, width-only, or height-only size forms. | Standard Markdown images from the recording are not rendered by this subsystem. |
| Context exclusions | The parser skips fenced code with a line-based toggle. It does not structurally exclude inline code, escaped syntax, comments, or distinguish matching fence delimiters. | Replace the scan with syntax-aware extraction and explicit malformed-input behavior. |
| Rendering | `images/imageEmbeds.ts` provides view-plugin decorations; `imageEmbedWidgets.ts` replaces the embed source with a span/image widget. | Keep rendered widgets but change how source mode and selection control decorations. |
| Selection | A caret or range inside an embed hides the widget. Image pointerdown moves the caret to `from + 2`, triggering source exposure. | This is the reverse of the desired rendered-selection behavior. |
| Resizing | A bottom-right handle changes DOM width during drag and commits `![[filename|width]]` on pointerup. Width is clamped to at least 96 and at most editor width minus 32. | Useful existing behavior, but no keyboard sizing, reset, source-preserving patching, or complete gesture lifecycle. Height is discarded on resize. |
| Asset loading | Widgets invoke `read_image_asset_data_url` directly. The Rust command reads the whole file from `Running Vault/assets`, requiring a single basename, and returns base64. | A loader boundary is needed for testability, shared viewer loads, decoded Markdown paths, retries, and lifecycle ownership. |
| Caching | Global maps cache 128 asset URLs and 256 widget DOM elements. Widget keys are raw embed text plus occurrence count. | The same key in different notes/panes can reuse one DOM node. Keys also change when size text changes. DOM elements hold EditorView references beyond widget lifetime. |
| Pasting | `imagePaste.ts` accepts clipboard image files, removes selected text immediately, adds a mapped placeholder, stores all files concurrently, then inserts wiki embeds. Errors only log and remove the placeholder. | Preserve import capability, but protect selected text on failed storage and bind async completion to the initiating document lifetime. |
| Storage | `commands/asset_commands.rs` creates assets and avoids existing-name collisions. It is separate from canonical note-content saving. | Width/delete/source changes should use editor transactions; they do not require writing image bytes or a new note-persistence path. |
| Shared editing | `editorDocumentRuntime.ts` owns one document and undo root, broadcasts content changes to sibling panes, and preserves pane-local selection and scroll. | Image edits must use this path, with per-pane selection/preview/viewer state. |
| Transient UI | `paneTransientUiController.svelte.ts` and `paneTransientUiState.ts` coordinate slash, selection, and wiki-link menus. | Add image surfaces to this exclusion policy instead of independently stacking them. |
| Read-only contexts | Proposal review can reconfigure editor writability; History Mode renders literal diffs rather than these image widgets. Image handlers have no explicit writability checks. | Image mutations must honor editor capabilities. Adding editable image widgets to history is outside this feature. |
| Test coverage | `imageEmbedWidgets.test.ts` covers ranges and decoration visibility through headless stubs. Rust command tests cover asset naming, basename rejection, MIME, and base64 loading. | Pointer gestures, mounted DOM ownership, source-plus-preview, gallery, and clipboard behavior need real browser/native coverage. |

Paths above are under `src/lib/features/notepad/` unless marked Rust, which is under `src-tauri/src/`. Browser IPC fixtures in `src/lib/e2e/browserBackend.ts` currently contain no image-command handlers.

### Risks found by reading the code

These are structural findings, not reproduced runtime failures:

- **Shared DOM across panes:** a global key of raw target plus occurrence can retrieve a span already attached to another editor. A DOM node has one parent, so attaching it elsewhere can remove it from the first pane and redirect its event state.
- **Gesture cancellation:** pointercancel removes tracking listeners but does not restore the starting styles. There is no widget destroy hook to cancel active window listeners or release retained view references.
- **Stale targets:** mutable widget state is used on pointerup without a gesture token and document-lifetime validation. Shared edits, removal, or navigation during a drag require explicit revalidation.
- **Round-trip loss:** reconstruction from filename/width/height cannot retain labels, titles, syntax choice, encoding, or other source details once standard Markdown is supported.
- **Parsing cost:** every content change scans the whole text; fence scanning is repeated for each match. Cache/index the parsed image inventory rather than rescan on unrelated selection movement.
- **Failed paste:** selected text is removed before image storage succeeds. A partial multi-file failure can leave successful assets without inserted references.
- **Asset freshness:** cached data URLs have no file-version invalidation. A retry/refresh path must be able to bypass an old result, and stale load results must not overwrite a newer target.

## Proposed product contract

### State and event behavior

| Context | Action | Proposed result |
| --- | --- | --- |
| Ordinary text | Arrow navigation reaches an image | Select its complete source range, keep it rendered, show image outline and controls. |
| Selected image | Next directional movement | Move to the appropriate text boundary or neighboring embed. Vertical movement respects visual layout; Shift-arrow remains normal range extension. |
| Rendered image | Click image body | Select it for editing/deletion on the first click; clicking the already selected image opens the viewer. |
| Rendered image | Zoom | Open viewer directly. |
| Selected image | Space | Open viewer; do not insert a space. |
| Selected image | Enter or source button | Reveal exact source with a live preview. Enter selects/focuses destination for editing; source button has the same intent. |
| Selected image | Tab | Reveal source and select existing size digits, or place the caret at the syntax's size insertion point. Avoid inserting a size until the user types. |
| Selected image | `+`, unmodified `=`, `-` | Increase/decrease persisted width; swallow the key only in this state. Proposed initial step is 50 CSS pixels, subject to visual validation; the recording does not prove this increment. |
| Selected image | `0` | Remove explicit size and restore intrinsic sizing constrained by available width. Preserve label, destination, title, and other source text. |
| Selected image | Backspace/Delete | Delete the embed range, leaving neighboring text and the asset file intact. |
| Selected image | Cmd/Ctrl-C or Cmd/Ctrl-X | Copy exact embed Markdown; cut removes it only after the clipboard event is successfully populated. No asset duplication or file deletion. |
| Source editing | Typing | Apply normal Markdown edits and update preview from the latest valid target. Invalid syntax stays editable; no guessing or file writes. |
| Source editing | Caret leaves the embed | Conceal source and return to rendered mode. |
| Selected image | Escape | Clear image selection to an adjacent caret without changing source. |
| Drag resizing | Pointermove | Preview only in the initiating pane; preserve aspect ratio; request editor layout measurement. |
| Drag resizing | Pointerup | Revalidate embed/lifetime and commit one isolated shared editor transaction. No transaction for an unchanged width. |
| Drag resizing | Escape, pointercancel, lost capture, detach, document replacement | Cancel listeners/capture and restore the authoritative rendered size. No Markdown change. |
| Viewer | Left/Right | Previous/next occurrence from the source note. Proposed default: stop at ends, disable unavailable navigation; do not wrap. |
| Viewer | `+`, `=`, `-`, `0` | Zoom in/out; reset to fit. These alter only viewer transforms. |
| Viewer | Drag | Pan when the image exceeds viewer bounds, with clamping; a drag must not count as a click on release. |
| Viewer | Escape, close button, click bare backdrop | Close and restore origin focus/selection/scroll. Ignore click-to-close when the pointer began a pan. |

Plain keyboard shortcuts must not fire during IME composition, when a text/size field has focus, on modified browser/app shortcuts, or when the image is only part of a general multi-range text selection. Tab handling must account for the existing `Prec.highest` indentation keymap; install conditional image bindings ahead of that handler or give the existing handler an explicit image-mode guard.

Keep Cmd/Ctrl-Z and redo on the shared runtime. Each drag, delete, cut, or reset is an isolated undo action. Group one uninterrupted repeated-key resize burst separately from adjacent typing and from later gestures. Do not install a second pane-local content history.

### Size semantics

Persist width in integer CSS pixels. Proposed interactive minimum is 48 pixels so small thumbnails remain possible; retain positive manually authored dimensions below that threshold rather than rewriting them on render. Interactive growth uses the available image container width as its upper bound. A narrower pane clamps presentation without changing a larger authored width. Reset removes both explicit dimensions. Interactive resizing of a legacy width×height or height-only embed derives its current rendered width, switches that embed to proportional width-only sizing, and remains undoable.

Use padding inside the widget for spacing, not vertical margins on CodeMirror block decorations. Provide a visible keyboard focus treatment and sufficient pointer target size for the corner control.

### Local asset compatibility

Support existing `![[photo.png]]` and dimensions, plus standard Markdown `![label](photo.png)`, `![label|200](photo.png)`, and `![label|200](assets/photo.png)`. Decode percent-encoded local destinations exactly once for resolution, preserve their original spelling in source, and retain optional titles and angle-bracket destinations. Use the existing Markdown tree for balanced/escaped destinations rather than another simplistic regex. Reference-style Markdown images should resolve through the same tree/definition index without rewriting shared definitions; a local width change belongs on the image's label.

Initial local resolution is deliberately bounded to the existing vault asset directory: a bare basename or an explicit `assets/` path can resolve there, including contained subdirectories if the backend resolver is extended. This covers the recorded filename and existing pasted images. Arbitrary note-relative files elsewhere in the vault, remote images, external file URLs, and raw HTML images remain preserved source with an explicit unsupported/unavailable presentation. They need a separate resolution/CSP decision and are not demonstrated here. Do not silently search the entire vault for duplicate basenames.

Canonicalize the allowed root and target and reject paths escaping it, including symlink escapes. Reject unsupported schemes and decode errors explicitly. Keep supported local formats from the current implementation. Image preview must not execute arbitrary HTML/SVG in an iframe.

## Proposed implementation architecture

### Ownership

| State or behavior | Owner |
| --- | --- |
| Authored image syntax and size | Canonical note Markdown; live transactions through `EditorDocumentRuntime`, then existing `NoteDraftState` save queue and `NoteTimeline`. |
| Parsed image inventory | A derived CodeMirror index for the current document, with source ranges and source-preserving edit spans. It is not another document owner. |
| Selected image/source mode | One pane-local CodeMirror StateField. Selection range and mode identify the interaction; toolbar rendering derives from it. |
| Gesture preview | One private view-plugin controller tied to an EditorView, pointer identity, mapped embed reference, and DocumentHandle/runtime lifetime. |
| DOM widgets | The owning EditorView only; never a global DOM cache. |
| Asset requests/results | Running Vault scoped asset loader; decoded resource URLs may be shared, not DOM or view references. |
| Viewer visibility and invoking pane | `PaneTransientUiController.active` extended with image viewer payload. Its union is the visibility authority; do not add a second global `viewerOpen` store. |
| Viewer image index and transforms | Private session payload/controller owned by the active image-viewer surface. |

Suggested private files under `images/` are `imageEmbedModel.ts`, `imageInteractionState.ts`, `imageInteractionExtension.ts`, `imageCommands.ts`, `imageResizeController.ts`, `imageAssetLoader.ts`, `imageViewerSession.ts`, `imageViewerGeometry.ts`, and `ImageViewer.svelte`. These names describe responsibilities; combine small helpers when a separate module would only forward calls.

Expose one assembled image extension to `editorExtensions.ts` and one viewer surface to Notepad's existing transient composition. Inject asset reading and view callbacks through `ImagesConfig`/`SharedEditorResources`, following their established callback registry. Do not make widget code invoke Tauri or reach into workspace stores directly.

### Parser and source-preserving edits

Return a normalized image reference with syntax kind, total source range, original source, decoded local target, label/destination/size spans, dimensions, and ephemeral occurrence identity. Build standard images from Markdown `Image` nodes and their definitions. Add a wiki-image node to the existing Obsidian Markdown extensions because the current wiki-link parser explicitly excludes embeds.

Use syntax context to reject inline/fenced/indented code, escaped embeds, and comments. Rebuild or incrementally map the derived inventory on document changes and parser completion, not every unrelated selection event. Viewer inventory must cover the whole source document; partial background parsing cannot silently yield a viewport-only gallery. Resume bounded parsing if needed and expose loading until inventory is complete.

Resize/reset patches only the size span or its insertion site. Examples:

```md
![[photo.png]]                         -> ![[photo.png|300]]
![[photo.png|200]]                     -> ![[photo.png|300]]
![Citrus](20220530163503%20Citrus.png)   -> ![Citrus|300](20220530163503%20Citrus.png)
![Citrus|200](assets/citrus.png "Chart") -> ![Citrus|300](assets/citrus.png "Chart")
```

Reset removes only the recognized size suffix. Unknown aliases, labels, and unsupported source must survive unrelated operations. Do not eagerly normalize formatting or silently convert between wiki and standard syntax.

Track occurrences with mapped ranges and an ephemeral identity scoped to a view/document lifetime, not filename or ordinal alone. Map references through ChangeDesc and reparse/revalidate affected spans before actions. The same asset embedded twice is two independent editing occurrences and two gallery entries.

### Decorations and selected-image behavior

Use direct StateField-provided decorations for standalone image blocks and source-plus-preview blocks, with inline replacements for inline images. The installed CodeMirror types explicitly prohibit view-plugin-provided block decorations that alter vertical layout; simply adding `block: true` to the current ViewPlugin is invalid.

Rendered mode conceals the source and displays the widget. Source mode leaves the exact source editable and adds a preview below a standalone source line. Inline source remains in surrounding text with a contextual preview that does not consume neighboring prose. Only standalone blocks use block layout; images in lists, blockquotes, and table cells must preserve those containers.

Atomic ranges can help navigation skip hidden source, but they do not themselves establish selected-image semantics. Conditional arrow commands must create the complete image range and distinguish that exact selection from a general text range. Suppress the ordinary text selection menu for this exact image selection; mixed text/image selections retain ordinary editor behavior. Suppress the custom text caret layer when its position represents a selected image rather than text.

Use WidgetType equality/updateDOM to retain an image element within its own view as source width changes. Implement destroy hooks for gesture cancellation, resource release, and DOM observers. Call `requestMeasure` after image decoding, drag previews, and source-preview height changes. Use CodeMirror measurement and a stable visual anchor for scroll preservation rather than unconditional microtask restoration of stale scroll offsets.

### Asset loader and import lifecycle

Introduce a small loader seam shared by widgets and the viewer. Initially retain the backend's data-URL transport behind it; changing to streamed custom-protocol assets is a separate optimization contingent on measurements, not required for interaction parity. Bound cache by retained bytes as well as entry count, deduplicate in-flight reads, provide retry/invalidate, and correlate results with asset target plus request generation. Releasing a view must not allow its pending request to write to a later view.

Keep resource cache keys scoped to Running Vault and normalized asset identity. Add a file-version/change signal or revalidation policy if external asset replacement must refresh automatically; at minimum explicit retry and viewer reopening must be able to refresh. Asset changes should invalidate image resources without becoming note-content edits or fabricated Note Revisions.

For paste, bind jobs to DocumentHandle/runtime lifetime, map insertion/replacement ranges, and avoid deleting selected text before storage succeeds. A successful import commits its replacement and embed insertion as one undoable change. Report failures visibly with retry/cancel. For multiple files, retain successfully stored results in the job so retry does not duplicate them; either finish missing imports before insertion or offer an explicit successful-subset insertion. Navigation/detach cancels UI adoption, with no completion in another note. Undo removes references while keeping the assets available.

Backend asset import can be hardened to create files exclusively and publish completed bytes atomically if this work touches storage, but it must not invent an alternative Markdown save path. Do not add automatic orphan deletion: undo and retained Note Revisions can still reference those files.

### Viewer geometry and lifecycle

Use a Svelte modal within the current app window, not OS fullscreen or another editor pane. Snapshot the source document inventory in source order when opening; retain the origin DocumentHandle, runtime revision, pane, mapped selection, and scroll anchor. All image occurrences remain navigable regardless of widget visibility. Filename and accessible image label come from the resolved reference.

Fit scale is `min(availableWidth / intrinsicWidth, availableHeight / intrinsicHeight)` with an initial cap of 1 to avoid enlarging small raster assets. Viewer growth/shrink uses a proposed factor of 1.2; clamp between fit and 8 times natural scale. These values are design defaults, not measured Obsidian constants. When fit itself exceeds the maximum, choose a coherent bound rather than producing an invalid interval.

Represent transforms as scale and translation. Center axes where the scaled image is smaller than the viewport; clamp overflowing axes to half the excess dimension. Pointer-centered zoom preserves the image point under the cursor; keyboard zoom uses viewport center. Navigating to another occurrence resets fit and pan. Dimension changes recompute bounds. Drag uses pointer capture and releases it on every cancellation path.

Trap modal focus, make the editing workspace inert, label controls, expose previous/next/zoom/reset through buttons as well as keys, and respect reduced motion. No keyboard event inside the viewer may delete an embed or resize authored Markdown. Missing images remain gallery entries with filename, error/retry, and working navigation/close controls.

Close the viewer before source-document navigation, pane destruction, runtime replacement, restart, History Mode entry, or proposal-review takeover. On sibling-pane edits, update the mapped origin selection; close on image inventory changes that invalidate the pinned viewer list rather than silently switching to another occurrence. Restore focus only when the origin lifetime still exists. Closing a viewer does not create a save or Editing Window boundary by itself.

### Architecture constraints

Follow [ARCHITECTURE.md](../../ARCHITECTURE.md), [behavior invariants](../../docs/architecture/behavior-invariants.md), [ADR 0002](../../docs/adr/0002-own-note-timelines-at-the-canonical-mutation-seam.md), and [ADR 0007](../../docs/adr/0007-retain-editor-history-at-editing-window-boundaries.md). Read the linked [Editing Window contract](../../docs/architecture/editing-window-contract.md) during integration.

Image-size and embed-content changes remain ordinary editor authored mutations. Shared panes see one content change and one shared undo action while retaining independent selections and scroll. Viewer transforms, source visibility, and temporary drag styles remain ephemeral and do not create Note Revisions. Asset bytes are not versioned by note history today; the plan must not promise historical image-byte restoration.

Every mutation checks current editing capabilities, read-only state, document lifetime, and target validity. In read-only contexts, inspection may remain available while size/source/delete/cut/paste changes are unavailable. History Mode currently uses literal diffs; this feature must preserve that representation and its missing-asset warnings. Align local percent-decoding and assets-path resolution with the existing Rust historical asset-reference extraction so a valid image is not falsely reported missing.

Update architecture documentation and applicable behavior invariants when adding transient ownership. An ADR is warranted only if implementation settles a lasting source-format, asset resolution, or persistence decision with a substantive tradeoff. No editor-framework replacement or history-store format change is justified by the requested behavior.

## Implementation sequence

| Ticket | Scope | Depends on | Exit condition |
| --- | --- | --- | --- |
| [01](issues/01-image-model-and-source-edits.md) | Parse both syntaxes and implement lossless size edits. | None | Round-trip examples, context exclusions, duplicate occurrences, and encoded paths pass. |
| [02](issues/02-asset-loader-and-pane-local-widgets.md) | Inject loader, isolate DOM, implement source-plus-preview decorations. | 01 | Two panes can mount identical embeds; source edits keep a preview; geometry stays correct. |
| [03](issues/03-image-selection-and-keyboard-actions.md) | Rendered selection, toolbar, navigation, source/size shortcuts, clipboard/delete/undo. | 01, 02 | All image commands coexist with text, indentation, cursor, and selection-menu behavior. |
| [04](issues/04-image-resize-gestures.md) | Pointer preview, keyboard burst grouping, cancellation, mapped target validation. | 02, 03 | One drag is one undo action and every cancellation leaves source unchanged. |
| [05](issues/05-image-viewer.md) | Modal lifecycle, whole-document gallery, zoom, pan, focus restoration. | 02, 03 | Viewer reproduces the recorded inspection flow without mutating Markdown. |
| [06](issues/06-import-and-document-lifecycle.md) | Safe paste/retry, read-only checks, pane/document replacement, asset-reference agreement. | 01–05 | Pending jobs/gestures/viewers cannot affect a different document; failures retain authored work. |
| [07](issues/07-interaction-verification-and-docs.md) | Browser/native coverage, compatibility, performance probe, architecture notes. | 01–06 | Recorded journey and edge cases pass; source format and ownership are documented. |

Ship the coherent interaction contract, not an isolated viewer that still reveals source on keyboard image selection. Build tests at each ticket's boundary; ticket 07 exercises the combined experience.

## Validation and acceptance

### Pure and state-level checks

- Parse wiki and Markdown images, sizes/labels/titles, escaped/percent-encoded paths, balanced parentheses, angle-bracket destinations, reference-style images, and duplicate assets.
- Ignore inline/fenced/indented code and escaped/commented syntax; keep malformed source editable.
- Resize/reset changes only size bytes; syntax, label, destination spelling, title, surrounding whitespace, and line endings remain intact.
- Map selected/source/resize references through insertions, shared-pane edits, deletion, and runtime replacement; do not retarget an old operation to a different image at the same offset.
- Verify selected-image commands, Shift-arrow behavior, typing outside image mode, IME, modifier guards, conditional Tab precedence, and shared undo grouping.
- Verify fit/zoom/pan calculations for portrait/landscape, small/large/zero dimensions, viewport changes, and boundary clamping.
- Verify loader deduplication, cache eviction/retry, superseded results, and import partial failures through the injected seams.

### Real browser journeys

Extend `src/lib/e2e/browserBackend.ts` with deterministic image read/import results, delayed and failed loads, and note fixtures with several images including one below the fold. Use the real Svelte app and mounted CodeMirror views.

1. Open the leading image, advance to offscreen image occurrences, Escape, and assert restored scroll/focus/selection.
2. Select a rendered image with an arrow, delete it, undo, shrink/grow, and drag the corner; assert stored source changes and aspect ratio.
3. Open Citrus with Space, zoom with `=`, pan in both axes, and Escape; assert no Markdown or save-command change from viewer actions.
4. Enter source mode, set `|200`, leave source, grow, and reopen source; assert label/destination preservation and a live preview throughout.
5. Use Tab, reset, copy/cut/paste, undo/redo, and text typing; assert no image key escapes into unrelated typing or indentation.
6. Display the same note in two panes and the same asset in different notes. Neither pane loses its image; resize broadcasts content while selection/scroll remain local.
7. Cancel a drag or delay import/read while switching/closing/replacing a document; assert no stale adoption or leaked handler.
8. Exercise images in lists, blockquotes, table cells, and inline prose; pointer hit-testing and caret geometry after each image must remain usable.
9. Exercise missing assets, malformed source, narrow panes, read-only/review takeover, History Mode entry, modal focus, and reduced motion.

### Native and backend checks

Use Rust tests for decoded/contained asset resolution, traversal/symlink rejection, allowed MIME formats, collision behavior, and agreement with historical missing-asset extraction. Extend native E2E only for real WebKit clipboard, pointer capture/cancellation, filesystem import, persisted width/reopen, and missing-file behavior. Browser-only clipboard assertions do not establish native macOS parity.

Run `pnpm check`, focused Vitest image/runtime/transient tests, focused browser image specs plus existing cursor/selection-menu regressions, and relevant Rust tests. Then run the existing suite once for integration. Use the repository's native build/test workflow; avoid repeated broad builds unless a failure or new change warrants them.

Probe a note with many image occurrences and a few large local assets. Assert stable DOM within a pane across selection/width changes, bounded resource retention, deduplicated reads, and no document rescan per drag frame. Measure before replacing data-URL transport or adding thumbnails; do not assert an unmeasured latency target.

### Investigation verification already completed

The existing `imageEmbedWidgets.test.ts` and `editorDocumentRuntime.test.ts` pass: **15 tests across two files**. This verifies their current headless contracts only. It does not verify the proposed functionality or reproduce the structural risks above. No application code or existing work-in-progress files were modified for this plan.

## Remaining design choices

The plan supplies implementable defaults for resize steps, minimum width, gallery edges, fit/zoom bounds, click behavior, and clipboard content. They can be tuned during visual validation without changing ownership. Exact Obsidian timing/animation constants and operating-system clipboard image representations are not established by the recording. Remote/note-relative image resolution and historical asset-byte versioning are separate scope decisions, not prerequisites for reproducing the recorded local-image workflow.

## Implementation decisions (2026-10-02)

The implementation uses `imageState` for pane interaction state and a parsed inventory cached by immutable CodeMirror document identity. Direct state decorations provide standalone blocks and retained source previews; inline images use inline widgets. Source typing keeps the last valid asset preview while an intermediate destination does not parse. Source edits themselves remain ordinary Markdown edits.

`SharedEditorResources` owns the bounded byte loader; per-view widgets own DOM, asynchronous presentation guards and gesture cleanup. Data-URL IPC remains, with contained-path canonicalization and a stat fingerprint command. The viewer uses a native HTML modal dialog composed through the existing pane transient union. Transient transitions skip assigning unchanged state, preventing editor callbacks during modal teardown from resurrecting a retired viewer.

Image layout mutations use the existing shared editor root. `imageResizeHistory` is installed on that root to group repeated keyboard sizing separately from adjacent typing; pointer gestures and resets remain isolated changes. Clipboard event handlers complement shortcut handling so native Copy/Cut commands preserve the same authored and undo semantics. Unsized/sized collapsed and shortcut references become explicit references when required to preserve their original destination lookup.

Full-document parsing occurs once per changed immutable document and is reused for selection updates. The 500-image probe does not currently justify incremental parsing or a streamed asset protocol. See [validation](validation.md) for actual checks, measurements, and the limits of the native automation evidence.
