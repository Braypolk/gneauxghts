# Explore clouds directly with animated focus

Status: ready-for-human
Type: task

## Request

Clicking a cloud should focus its region and open the info panel, with a short
animation instead of a hard camera cut. Region names remain visible inside
clouds but no longer have a separate click action.

## Change

Each cloud is one pointer and keyboard control using the existing region
inspection action. Captions are passive and let pointer hits reach the cloud
underneath. Notes and filenames retain their own controls. Cloud drags retain
pan behavior and suppress the following click.

Region focus interpolates the visible world center and zoom with a 300 ms
ease-out. Reduced-motion settings skip the animation. Pointer gestures, wheel
and keyboard zoom, Fit map, another region focus and component teardown cancel
the pending animation. Camera state remains local to AtlasMap.

## Verification

All 23 map browser tests pass, including surface/caption clicks, keyboard
region focus, cloud drag suppression, intermediate animation frames, Fit map
interruption and reduced motion. Existing note interactions, empty-canvas
deselection, pinch, search and routing checks also pass. Type checking reports
zero errors/warnings; the production build and diff whitespace checks pass.
