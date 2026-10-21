# Bottom bar animation inventory

The bottom bar has three main surfaces: Search, Related, and Chat input. Its full
animation behavior depends on the surface and content being shown, the active
pane, whether any chat remains open, the available space, and whether another
transition is already running. The same visible destination can require different
motion depending on how the user reaches it.

This inventory covers those combinations for animation cleanup. Current behavior
and timing are recorded below; the cleanup checklist identifies work to assess,
without treating every combination as an implemented or verified transition.
The existing [motion spec](spec.md) and
[behavior invariants](../../docs/architecture/behavior-invariants.md#search-and-chat-share-a-dock-without-replacing-their-drafts)
remain the implementation context.

## How to describe one animation case

Record each case using these fields:

| Field | Examples |
| --- | --- |
| Starting and ending surface | Search to Related; Chat input to Search |
| Starting and ending content variant | Empty focused search; retained query; multiline composer |
| Content owner | Same note; different note; same chat; different chat |
| Pane configuration | Single editor; editor and chat; two editors; two chats |
| Pane operation | No pane change; activate; replace kind; open; close |
| Chat availability | No chats; one or more remain; last chat disappears |
| Available size | One-row bar; two-row bar; ordinary split; collapsed rail |
| Trigger | Pointer; keyboard; focus; navigation; resize |
| Motion condition | Settled; interrupted; reversed; reduced motion |

These fields describe valid scenarios rather than an unrestricted multiplication
of states. For example, Related needs an eligible active note; it is not a settled
surface for an active chat or History Mode.

## Main surfaces and their variants

### Search

| Variant | Visible behavior |
| --- | --- |
| Idle with no query | Without chat, the ordinary compact editor bar; no popup. |
| Focused with no query | Expanded search controls and an open popup with the applicable empty-query content, such as Recent and Pinned. |
| Focused with a text query | Expanded controls, query, and search results or search status. |
| Unfocused with a text query | Query and expanded layout remain; the popup and focus-specific controls can close. |
| Image query, with or without text | Query preview and clear control; the image keeps the expanded layout even without text. |

Search with a chat still open uses the shared dock's available bar width. In
Search mode, its expanded presentation is explicitly retained, including when
empty and unfocused. That differs from ordinary idle editor search after the last
chat closes.

Scope, match case, whole word, result navigation, and query previews can change
the controls inside Search. Loading, results, no matches, and errors change popup
content. They are content variations within Search, not additional main surfaces.

### Related

Related shows the note-specific heading and results in the shared popup. Its icon
is absorbed into the bar and Search becomes a floating circle. The retained search
query and scope survive the exchange.

| Variant | Animation concern |
| --- | --- |
| Opened from idle Search | Width, circles, heading, and popup must enter together. |
| Opened from expanded Search | Begin from the displayed expanded width and height. |
| Loading, populated, empty, insufficient, stale, or unavailable results | Update the popup without restarting the main exchange or moving authored note content. |
| Refresh or Retry | Retain the current rows and popup geometry while content changes. |
| Open with a chat retained elsewhere | Include the chat return control and use the shared dock constraints. |

Changing the active pane or note dismisses Related. Returning from Chat to a note
does not automatically reopen the previous Related popup. Related to Chat can be
a departure from an open note popup, but Chat to Related requires an eligible
note context first. These directions are not an unconditional symmetric pair.

### Chat input

| Variant | Animation concern |
| --- | --- |
| Empty draft | Base composer height and disabled Send appearance. |
| Sendable draft | Enabled Send appearance without changing the circle shell. |
| Multiline draft | Measured height growth and shrinkage, anchored at the bottom. |
| Attachments present | Attachment content and any resulting height change. |
| Generation running | Stop replaces the Send glyph while preserving control geometry. |
| Returning to a retained chat | Restore that chat's own draft, attachments, configuration, and measured composer. |

These variants overlap: a multiline draft may also have attachments while a reply
is running. Model, scope, permission, and configuration popovers are auxiliary
controls; opening them does not select another main morphing surface.

## Surface transitions within the existing workspace

| Transition | Required behavior to inspect |
| --- | --- |
| Idle Search to focused Search | Expand the bar and controls, then expose the appropriate popup content. |
| Focused empty Search to idle Search | Close the popup and collapse the empty layout where ordinary editor sizing applies. |
| Focused populated Search to unfocused populated Search | Retain query and expanded layout while closing focus-specific presentation. |
| Unfocused populated Search to focused populated Search | Reveal active controls and popup without unnecessarily collapsing first. |
| Populated Search to empty Search | Clearing collapses only when focus, image query, and chat-mode rules permit. |
| Search to Related | Exchange selected icon and bar content; retain outgoing Search layout until its fade finishes. |
| Related to Search through the Search circle | Restore the retained query and scope, focus Search, and hand off popup content. |
| Related dismissed by Escape, toggle, or outside focus | Close Related and restore the applicable Search presentation; focus restoration depends on the trigger. |
| Search to Chat input | Hide outgoing contents, exchange the circles and bar, unfold composer height, reveal chat controls. |
| Chat input to Search | Compress composer height, exchange controls, reveal Search, then admit its popup as applicable. |
| Related to Chat input | Dismiss Related and reach the selected composer's measured destination without flashing Search contents between them. |
| Composer content changes | Reconcile height and Send or Stop presentation without replaying a surface exchange. |

Search and Related share a popup shell. Switching their already-open content
should not produce two overlapping popups. Closing a popup and switching its
content are separate events with different reveal behavior.

For Search and Chat exchanges with stable item membership and width constraints,
the bar exchanges ownership while retaining its width. Capped inputs stay
centered while their sibling circles translate together; narrow layouts keep
the circle endpoints fixed while the bar moves between them.
Adding or removing a circle, changing available width, or changing pane layout
introduces a separate width change that must be accounted for.

## Every editor to chat departure

Inspect each of these starting presentations:

1. Idle empty editor Search.
2. Focused empty editor Search with its popup open.
3. Focused populated editor Search with results or status visible.
4. Unfocused populated editor Search with its expanded layout retained.
5. Editor Search with an image query.
6. Related open, including entry from compact and expanded Search.

For each applicable start, distinguish the destination: a new empty chat or a
retained chat with its own draft, height, attachments, or running generation.

| How chat is reached | Additional movement |
| --- | --- |
| Replace the editor's pane kind with Chat | The pane identity can stay the same while its content and dock target change. |
| Open a new chat beside the editor | Pane membership, card layout, dock bounds, and surface can change together. |
| Split using a current or previous chat location | Adopt the selected chat directly and use its actual composer destination. |
| Activate an existing chat in a wide split | Both panes remain visible; active ownership and dock presentation change. |
| Activate a collapsed chat in a narrow split | Rail and pane reveal accompany the dock handoff. |
| Use the dock's chat circle | Activate its retained chat owner and expand that composer's surface. |

The arrival must not briefly show an unrelated chat draft, an idle Search layout,
or an intermediate composer height from another chat.

## Every chat to editor return

The destination Search presentation follows the retained query, focus and
navigation rules. It is not always the compact empty editor bar, and a previous
Related popup is dismissed rather than automatically restored.

| How the editor is reached | Destination distinction |
| --- | --- |
| Replace the only chat with an editor | Remove chat availability and return to ordinary editor Search sizing. |
| Replace one chat while another remains | Retain the shared Search and Chat dock and choose the remaining chat return owner. |
| Activate an existing editor in a wide split | Keep chat mounted and retain the wider shared dock. |
| Activate an editor behind a collapsed rail | Reveal the editor and move the rail on the coordinated dock clock. |
| Close the last chat | Remove its circle, contract to ordinary Search constraints, and resolve the remaining pane layout. |
| Close a chat while another remains | Preserve chat availability; the resulting active pane determines the selected surface. |
| Navigate back to an editor in the same pane | Apply the resulting chat availability and editor query state even when the pane ID is unchanged. |

Repeat these cases with empty, populated, multiline, attachment-bearing, and
running composers where valid. Retained chats keep their own state through a
departure; closing a chat follows the existing pane lifecycle rules.

## Split pane configurations

The dock is shared workspace chrome. Its width is derived from its available
workspace space; it is not simply the width of the active editor column.

| Configuration | Applicable bar behavior |
| --- | --- |
| Single editor | Ordinary Search and Related; no retained chat circle. |
| Single chat | Search and Chat input; Related is absent for the active chat. |
| Two editors | Search and Related follow the active note; no chat circle unless another chat also exists. |
| Editor and chat | Active editor normally selects Search; active chat selects its composer. Related is available for the eligible note context. |
| Two chats | Search and the selected composer's surface; switching chats must hand off composer ownership correctly. |
| Larger pane sets, where supported | Apply the same owner and chat-availability rules; include all retained rails and the selected return chat. |

For every supported configuration, inspect these operations independently:

| Operation | Difference from a local surface switch |
| --- | --- |
| Switch Search and Related within the active note | Pane ownership stays fixed; local dock geometry and popup contents change. |
| Switch Search and Chat while retaining the active chat | Surface changes without creating or replacing a conversation. |
| Switch between notes | Search may stay Search while note context changes; Related dismisses. |
| Switch between chats | Surface may stay Chat input while draft, controls, and height change owners. |
| Switch between editor and chat | Surface and owner change together; chat availability may stay unchanged. |
| Open a split | New pane reveal and dock bounds may move alongside the surface exchange. |
| Close an expanded pane or collapsed pane | Different visible origins; resolve whether the survivor is an editor or chat and whether any chat remains. |
| Resize across the ordinary split and rail boundary | Reconcile the retained owners and destination layout, settling any current morph. |

In a wide split, both pane contents can remain visible. In a compact split, the
rail moves while the destination content is revealed. Text keeps its chosen
wrapping while pane bounds and clips animate. Header, rail, outer actions, and
dock must not use unrelated clocks for the same operation.

## Display size and available space

There are several independent size inputs. Testing only named device widths
misses narrow docks on large windows and compact pane layouts inside wide apps.

| Input | Current rule or consequence |
| --- | --- |
| Dock container width | At or below 28rem, Search uses the compact control arrangement; expanded Search unfolds an additional row and scope labels hide. Related uses corresponding compact height. |
| Chat availability | Without chat, ordinary Search targets 24rem when compact and 42rem when expanded; Related targets 42rem. Available space clamps these widths. With chat, the main bar uses available space after its sibling circles. |
| Pane card width and pane count | Compact pane mode applies when available width divided by retained pane count is below 360px. Its rails are 48px wide. This is separate from the 28rem dock rule. |
| Viewport width | Below 640px, Search uses larger touch sizing. The 640–699px band also has its own search-bar height. These rules can coexist with the dock container rules. |
| Root font size | Rem-based widths, controls, and the dock threshold change with it; the pane compact threshold above is in pixels. |
| Viewport height | Short windows change dock padding and some surrounding controls; available popup and reading space shrink. |
| Keyboard and safe-area insets | Reposition the dock's bottom anchor and affect visible reading space. |
| Composer content and available width | Wrapping and attachments change measured composer height. |

The baseline stays anchored relative to the current dock position during a local
morph. Keyboard or safe-area changes can intentionally move that position.

Size coverage should include just below, at, and just above each relevant boundary;
ordinary and rail splits; one-row and two-row bars; very wide capped layouts; and
short windows. Resizing during a container morph currently settles the selected
destination immediately rather than continuing the old trajectory.

## What moves during each transition

| Layer | What must remain coordinated |
| --- | --- |
| Outer dock | Position, available width, margins, and adjacent Forget and New action space. |
| Main bar | Left edge, width, measured height, corner radius, and bottom anchor. |
| Material | Opaque circle shells, neck, background, and outline from the same renderer at rest and in motion. |
| Foreground icons | Magnifier, Related, Chat, Send, and Stop positions, sizes, glyph handoff, and disabled brightness. |
| Surface content | Outgoing opacity, retained wrapping, incoming opacity, and clipping while composer height changes. |
| Popup | Its base, destination width, reveal or collapse, and content replacement. |
| Pane layout | Card bounds, pane widths, clips, rails, header geometry, and content opacity when the pane operation requires them. |
| Reading area | Bottom fade and scroll clearance, including the largest relevant input height during a morph. |
| Interaction | Input focus, keyboard target, pointer hit areas, disabled controls, and accessibility visibility. |

Background shells and foreground glyphs are separate geometry. A shrinking Send
glyph does not imply a shrinking circle shell. The joining filter affects the
material only; text and controls must stay sharp.

## Timing currently in use

| Motion | Timing |
| --- | --- |
| Container exchange | 380ms nominal duration with `cubic-bezier(0.65, 0, 0.35, 1)`, including Search, Related, and Chat morphs. |
| Coordinated pane movement | Samples the selected dock curve and remaining duration; layout-only transitions use the editor curve. |
| Interrupted container request | Starts at the displayed pose; duration scales with remaining selection travel, with a quarter-duration minimum when selection distance is nonzero. |
| Ordinary Search content expansion | 460ms with `cubic-bezier(0.32, 0, 0.2, 1)`. This remains separate from the container exchange clock. |
| Outgoing surface content | 100ms opacity transition. |
| Incoming surface content | Admitted at 90% geometry progress for a surface exchange, then fades over 280ms, continuing after geometry settles. |
| Search and Related popup | 350ms reveal and 275ms collapse, using the Search expansion curve. Entry from Chat waits for dock geometry; ordinary Search and Related entry can reveal alongside expansion. |
| Reduced motion | Container geometry settles immediately and relevant CSS and popup transitions are disabled. |

The 90% threshold is eased geometry progress, not 90% of elapsed time. Scope-label
and match-option fades also have their own CSS timing. A common container curve
does not mean every content animation already has identical timing.

## Interruption and interaction cases

Apply these to the transition families where the actions are reachable:

- Reverse immediately, midway through the exchange, and during the incoming fade.
- Retarget a third surface, including Search to Related to Chat where available.
- Switch panes or replace pane kind while a local exchange is running.
- Close the active pane or last chat during an exchange; reopen or choose another
  retained owner before the previous transition finishes.
- Resize within a layout and across dock or pane boundaries during motion.
- Enable reduced motion while geometry or content is still animating.
- Change Search query, image query, scope, or results while its popup is visible.
- Add or remove attachments, wrap text, or change Send to Stop while entering or
  leaving a composer.
- Activate with pointer, keyboard shortcut, rail, header, Search circle, and Chat
  circle; verify each action's intended focus destination.
- Repeat an already selected action without replaying the exchange unnecessarily.

Each new request begins from the currently painted geometry and opacity. Obsolete
frames cannot finish a newer operation. Temporary layout projections, rail-title
snapshots, and animation effects must be released on completion or cancellation.

## Acceptance checklist

For each recorded scenario, check:

1. Correct destination surface, content owner, icon membership, and enabled state.
2. Correct first painted frame, with no destination flash before travel starts.
3. Continuous bar and glyph paths without unexplained reversal or width-cap hitch.
4. Background and outline continuity through joining and settling.
5. Stable text wrapping where content is being revealed or hidden.
6. Correct popup timing, base, and width, with no duplicate panel or stale results.
7. Preserved queries, drafts, attachments, configuration, editor selection, and
   scroll state where the owning pane remains open.
8. Intended focus and pointer behavior without an incidental page scroll.
9. Sufficient reading clearance and a bottom fade fitted to the displayed bar.
10. Correct rapid reversal, retargeting, resize, and reduced-motion outcome.
11. Clean completion with no lingering effects or temporary layout attributes.

Track the start and end variants, owner, pane operation, size, trigger, and result
with each check. Include native WebKit paint inspection for the material and
outline; passing mathematical and browser geometry checks alone does not establish
native paint quality.

## Suggested cleanup sequence

1. Review local Search expansion and collapse in one-row and two-row layouts.
2. Review Search and Related opening, switching, dismissal, and reversal.
3. Review Search and Chat exchange with stable pane layout and empty or populated
   inputs, then variable composer heights.
4. Review all editor departures and chat returns, separating last-chat removal
   from returns that retain another chat.
5. Review wide splits, rail splits, and same-surface owner changes.
6. Review pane entry and departure, breakpoint crossings, keyboard insets, and
   interruptions across those operations.
7. Compare browser geometry with native WebKit paint and interaction behavior.

## Implementation and verification references

- [Container geometry and frame clock](../../src/lib/ui/morphing-containers/motion.ts)
- [Container renderer and content fades](../../src/lib/ui/morphing-containers/MorphingContainers.svelte)
- [Material and outline](../../src/lib/ui/morphing-containers/MorphingMaterial.svelte)
- [Workspace surface adapter](../../src/lib/features/notepad/ui/WorkspaceInputDock.svelte)
- [Search and Related activation](../../src/lib/features/notepad/ui/NotepadCommandBar.svelte)
- [Pane and chat selection](../../src/lib/features/notepad/Notepad.svelte)
- [Pane layout motion](../../src/lib/features/notepad/workspace/paneLayoutMotion.ts)
- [Search variants](../../src/lib/ui/search/SearchBar.svelte), [responsive controls](../../src/lib/ui/search/searchControls.css), and [Search timing](../../src/lib/ui/search/searchMotion.ts)
- [Popup reveal](../../src/lib/features/notepad/ui/searchResultsReveal.ts) and [dock positioning](../../src/lib/ui/search/SearchDock.svelte)
- [Workspace dock browser checks](../../e2e/specs/browser/workspace-input-dock.spec.ts)
- [Related browser checks](../../e2e/specs/browser/related-dock-layout.spec.ts)
- [Compact pane browser checks](../../e2e/specs/browser/responsive-pane-rail.spec.ts)
- [Native material checks](../../e2e/specs/native/workspace-dock-outline.spec.ts)
