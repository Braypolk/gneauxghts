# Wide split dock switching

Completed: 2026-10-12

Switching between note and chat panes in a wide split left the bottom dock in
its previous mode. Compact splits already selected the mode for their expanded
pane, but wide splits only automatically selected chat when its preferred pane
changed.

`Notepad.svelte` now detects active-pane changes in the existing dock
presentation effect. Selecting an editor shows search; selecting chat shows
its composer. Repeated activation within the same pane preserves explicit mode
selection. Mounted inputs and their drafts remain retained. WorkspaceStore
continues to own the active pane.

The mounted browser regression failed before the correction with search
expected and chat received after clicking the editor header. It then passed
for pointer and keyboard pane switching, explicit mode retention within a pane,
and preservation of search text and unsent chat without sending a message.

Validation: all 22 workspace dock and 19 responsive pane browser tests passed;
24 focused dock/architecture unit tests passed; Svelte checks reported zero
errors or warnings; E2E TypeScript and diff whitespace checks passed. Native
Mac and physical iOS execution were not part of this validation.

## Retained chat dock and handoff follow-up

The accepted UI now keeps the chat/search dock whenever any chat pane is open,
including beside an expanded editor on a phone. Selecting an editor presents
search with its chat return button. Clicking that button activates the retained
chat pane and focuses its composer. The unused collapsed-chat presentation
override was removed; the existing `chat-search`/`chat-input` animation owns
the handoff at every width.

The reported end-of-animation flash came from forcing incoming search visually
active during the morph, then releasing that override when it settled. Incoming
search now uses its actual focus state; only outgoing search retains its active
presentation through the existing fade. No animation timings, curves or CSS
were added or changed for this follow-up.

Mounted regressions sample the full handoff with empty and populated queries at
1440px and 390px. They verify no idle placeholder or match-options flash,
continuous geometry, the visible chat button, restored chat focus, and retained
drafts. Updated responsive checks cover the retained chat/search edge and
resize behavior. Final validation: 54 browser tests and 24 focused unit tests
passed; Svelte reported zero errors or warnings; E2E TypeScript and diff
whitespace checks passed. Native app validation was not run.

## Related layout and pane-kind follow-up

The supplied recording showed a second layout animation chasing Related’s
resize, plus asymmetric chat spacing. Frame sampling reproduced 80–84px of
idle-search travel despite identical starting and ending bounds. The balancing
margins had moved onto WorkspaceInputDock without their Related transition;
its pixel-based search coordinates then restarted the ordinary expansion
transition on every resize sample.

The actual dock margins now use the existing Related duration and easing.
Settled editor geometry resolves relative to its flex space in both the input
and SVG material. Search focus/query width changes still use the existing
search expansion curve. Expanded search also exposed the toolbar’s abrupt
82px-per-action icon breakpoint. Below that breakpoint, action widths now
release space continuously with the container instead of making search reverse.
Chat input and chat search do not apply standalone search’s asymmetric
reservation; their outer action gaps remain balanced when Related is open.

The two-chat reproduction independently failed with `chat` received after the
active pane became an editor. Dock mode now follows both active pane ID and
kind, preserving explicit mode choices while that identity stays unchanged.
The remaining chat button activates its retained pane and composer.

Mounted regressions cover idle and populated search through Related opening
and closing at 1440px and the recording’s 1624px CSS width, matching input and
material bounds, both retained chat dock modes with Related open, and the exact
solo-chat → duplicate-chat split → active editor path.


Validation for this follow-up: 80 browser checks passed (six new Related/pane-kind
regressions plus 74 existing dock, responsive rail, search, and pane animation
checks); 24 focused dock/architecture unit tests passed. Svelte reported zero
errors or warnings; E2E TypeScript and diff whitespace checks passed. Browser
frame checks bound reversal travel and verify matching input/material edges.
Native Mac and physical iOS execution were not run.
