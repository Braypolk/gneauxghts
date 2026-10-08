# Deselect a note by clicking empty canvas

Status: ready-for-human
Type: task

## Request

Allow deselection by clicking empty canvas, without minimizing the info panel.

## Change

An empty canvas click clears the selection, hover, browsing origin and source
read state through the same helper as panel closing. The panel stays open on
Regions, and the strength setting and camera are retained. Empty space inside
a cloud also qualifies; note dots, filenames and region labels keep their
own actions. The existing gesture suppression protects pan/pinch from
deselection. Double-clicking empty space deselects without opening a note.

## Verification

All sixteen map browser tests pass, including empty-click deselection, retained
panel/strength/camera, restored filenames, cleared edges, preserved selection
after panning, and empty double-click safety. Type checking reports zero
errors/warnings and the production build passes. The live map was checked by
selecting a note then clicking empty space: its reader was replaced by Regions,
the panel stayed expanded, and the connection lines disappeared.
