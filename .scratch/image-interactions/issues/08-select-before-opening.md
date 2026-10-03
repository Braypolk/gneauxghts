# Select an image before opening its viewer

Status: resolved
Type: task
Depends on: 03, 05

## Scope

User correction: the first image-body click selects its embed for deletion;
clicking the selected image again opens the viewer. Zoom and Space retain direct
viewer activation. Resize gestures must continue suppressing their trailing click.

## Acceptance

- First click selects the whole embed, focuses the editor, and leaves the viewer closed.
- Delete removes that embed and undo restores it through existing shared history.
- A subsequent click opens the viewer; clicking a different image selects it first.
- Browser interaction regression tests and type checks pass.

## Comments

This replaces the initially proposed single-click viewer default in the specification.

## Answer

Image-body pointerdown records whether the embed was already selected before selecting it. Its click opens the viewer only for that prior selection; otherwise it keeps the whole embed selected and the editor focused. Zoom/Space and resize cancellation retain their behavior. The pointer cursor changes to zoom-in only while selected.

Real browser coverage verifies first-click selection, Delete/undo, second-click opening, and first-click selection of a different image. All 11 image journeys pass. `pnpm check` passes with 0 errors and three unrelated existing prototype CSS warnings.

Evidence: [validation](../validation.md).
