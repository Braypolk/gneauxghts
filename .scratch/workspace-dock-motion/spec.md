# Shared workspace dock motion

The dock morphs one bar using Spotlight-style pinching and absorption. SearchBar
and the selected ChatComposer stay mounted in their existing owners. The motion
machine controls presentation and never owns drafts, attachments, configuration,
pane lifetimes, or persistence.

## Settled states and transitions

| From | To | Motion |
| --- | --- | --- |
| Editor search | Chat input | Magnifier splits out; bar grows to composer height; search controls fade into chat controls. |
| Editor search | Chat search | Bar expands to the chat dock width and releases the chat circle. |
| Chat search | Editor search | Chat circle is absorbed as the bar returns to editor search width. |
| Chat input | Editor search | Contents hide, magnifier is absorbed, and bar contracts to editor search width before search reveals. |
| Chat input | Chat search | Contents hide; send becomes a chat circle and pinches off; magnifier enters the bar. Search reveals afterward. Bar width stays constant. |
| Chat search | Chat input | Reverse the exchange, then restore composer height and controls. Bar width stays constant. |

Opening chat finishes with chat input expanded. Selecting a neighboring note
keeps the shared chat/search dock while any chat pane remains open. Selecting a
different chat expands that pane's own composer.

## Coordination

One frame clock drives compression, exchange, and settling. Requests during a
morph start from its current pose; obsolete frame IDs cannot complete newer work.
The morph retains its 300ms travel pacing with 80ms added around the connected
pinch for search/chat input exchanges. Editor/chat edges keep the same total
duration but use `cubic-bezier(0.65, 0, 0.35, 1)` for a gentler departure and arrival.
Pane and dock sample the same selected curve. Ordinary editor search expansion
remains 300ms.

Measured layout spaces blend on this clock so Related/pane changes do not move
the bar abruptly. The bottom baseline remains anchored. Resize and reduced
motion finish the selected state immediately.

Search queries and chat drafts both survive exchanges. Each input retains its text;
placeholder text is used only for empty inputs. Inputs remain mounted but their
contents fade out over 100ms at the start and stay hidden through exchange.
The selected surface begins a 280ms fade-in at 90% geometry progress, completing
after the bar settles. Another morph fades from the displayed opacity; reduced
motion skips the fades. The material
joining filter applies only to background shapes, never text or controls.

## Transition refinements

Adjacent actions interpolate their positions on the same clock as the bar when
pane/Related width changes. Circle exchange stays compact; composer height and
toolbar unfold afterward. Input contents reveal through and beyond settling. Glyphs
hand off sequentially, and editor transitions skip the chat-search glyph. Magnifier/send projections remain mounted at a fixed glyph
size rather than swapping with native controls at completion. Send's disabled
brightness survives composer removal, and moving circles ignore hover styling.
The native send/stop button stays transparent even when disabled or when composer
CSS loads later. It retains submission and focus while the persistent projection
alone paints the send/chat control, preventing doubled circles during exchanges.
The background and outline renderer remains identical in moving and settled
states; thinner connecting necks make the local pinch visible. Search results fade
in during settling. Action labels hand off without changing current action
semantics. Reading clearance holds its maximum until the morph completes.
When an editor/chat change also changes pane layout, card/route/pane bounds use
the dock's remaining frame clock. Pane layout publishes the dock's final flex
bounds after installing its animation effects. The dock follows a direct path
between its displayed origin and that measured endpoint, avoiding first-frame
destination flashes and width-cap kinks. Related balancing follows the displayed
card margins, keeping both outer actions inside the card throughout closing.
Search/chat exchange anchors both full-size opaque background circles while the
bar slides between them. Foreground send size and glyph position animate
independently, so overlapping translucent contours cannot leave top-edge artifacts
and neither end of the material reverses direction during the exchange.
The joined background is drawn in a single SVG group with its local filter
definition. Filtering separate composited HTML shapes can leave stale contour
fragments in WebKit. Ordinary editor search expansion animates the SVG rectangle
and absorbed circles together, keeping their outlines within the visible bar.
The projected magnifier follows that same left-position easing and duration,
remaining aligned with the native input glyph during expansion and collapse.

## Verification

Machine tests cover all directed transitions, constant exchange width, stale
frames, rapid retargeting, and immediate settling. Browser tests cover mounted
input identity, draft/query/attachment/configuration retention, editor entry and
exit, focus, fixed baseline, narrow viewports, scroll clearance, joining geometry,
rapid reversals, reduced motion, monotonic bar/glyph paths, fixed opaque circle
shells, and the first frame of a wide split-chat return to the editor. A native
WebKit check samples the outline during both exchanges and editor return.
