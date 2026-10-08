# Tune suggested connection strength live

Status: ready-for-human
Type: task

## Request

Add a slider to test different connection strength limits. Preserve unlimited
hard (authored) connections.

## Change

The floating Atlas info panel has a minimum suggested strength slider from 0
to 1. It applies an absolute cutoff across map edges, related filenames, dot
emphasis and reader browsing. Zero shows every available semantic candidate;
one shows only candidates at strength one. Authored links bypass every setting.
Auto restores the existing adaptive cutoff, which remains the initial default.
The setting lasts for the map visit without modifying published scores,
selection, loaded source or camera. It is accessible from Regions and Note,
outside the reader's wheel-to-browse area; native range keys do not zoom the map.

## Verification

All seven focused unit tests and fifteen map browser tests pass. The browser
journey exercises the slider endpoints and Auto, confirms unlimited authored
links, and checks agreement between edges, labels and reader browsing while
preserving selection, loaded full source and camera. Type checking reports
zero errors/warnings; the production build passes. In the live vault, the
example note changes from 79 of 79 suggestions at zero to none at one, and
Auto restores 11 of 79. The floating panel was visually checked with its note
reader still usable.
