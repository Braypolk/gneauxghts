# Compare compact Related button placements

Status: needs-info
Type: prototype

## Question

Where should Related live in the smaller window layout? The current floating pill sits above the bottom dock and feels detached from the note.

## Comparison

Run `pnpm related:lab`, then open `http://127.0.0.1:1424/?variant=A`.
The bottom comparison bar and left/right arrow keys switch variants. Text inputs retain their normal arrow keys.

- A: note-header action, becoming icon-only below 500px. Clears the writing area; crowds the header.
- B: a tab attached to the top of the bottom dock. Retains a visible label; still occupies space near bottom controls.
- C: a slim tab on the left edge, echoing the wide layout's left-side drawer. Low visual weight; less obvious.
- D: the current floating-pill baseline.

The launcher injects the prototype into the existing `/` route without changing the production page or Related components. It uses the browser fixture backend; native vault data is never accessed. Wide layout retains its existing drawer. Presentation code lives next to Related; the switcher is a shared throwaway component. No product decision has been made.

## Validation

Inspected at 585px and 390px widths. Existing panel toggle and close behavior are reused. The comparison reserves space below the workspace for its controls.

Full Svelte check reported an unrelated existing error in `src/lib/ui/NavBar.svelte`: `modal` is not a supported property of `DropdownMenu.Root`. No diagnostics were reported for the new prototype components.

## Next step

Get the user's preferred direction. After a decision, preserve this comparison on a throwaway branch and implement the chosen layout with normal production constraints; remove the lab code from the implementation branch.
