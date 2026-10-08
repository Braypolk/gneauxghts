# Promote approved cloud topic names

Status: resolved

The user approved the improved names and requested production adoption and
removal of the old naming version and comparison test.

## Comments

2026-10-04: Promoting the approved topic vocabulary/scoring policy through the
existing generation publisher, bumping label/cache version, and retiring the
comparison launcher, frontend controls and benchmark-only code. Keep regression
coverage for names, caching, note changes and publication compatibility.

## Answer

The approved topic names are now production `topic-atlas-v8`. The previous
word-mining labeler and all naming comparison/benchmark code have been removed.
The map consumes its normal AtlasStore response directly. The label/cache
version bump requeues naming on saved structures through the existing publisher,
without invalidating geometry. New labels use source `topic`; legacy artifact
source strings remain readable. Candidate embeddings are validated before use.
Callbacks retain sorted cloud-ID order and propagate supersession/errors. Large
sibling groups can reuse a readable topic rather than panic or borrow another
family's custom tag. No state owner, database schema, worker queue or canonical
note write path changed.

Validated: 42 Rust Atlas/naming/publication tests; 22 frontend Atlas store/layout
tests; `pnpm check` (zero errors/warnings); frontend production build; native
`cargo build`; script syntax, Rust formatting and diff whitespace checks. Update
regressions confirm changed note evidence, additions and removals rescore names
without additional provider calls when topic vectors are cached. Native UI
restart was left to the user so their running editor session stays intact.

The naming comparison browser tab and port-1423 server are closed. Private
snapshot/benchmark artifacts were deleted. Other work in the dirty checkout
was preserved.
