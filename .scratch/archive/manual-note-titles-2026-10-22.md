# Manual note titles — 2026-10-22

The user requested a button that generates a short informative title when a note's
title is empty. The editor now exposes a sparkle button beside a blank title,
disabled for an empty body. It uses the configured AI model only after a click
or keyboard activation. Progress and retryable failures are visible; a current
result enters the ordinary title/save path. See the subsequent
[untitled capture naming](untitled-capture-naming-2026-10-22.md) behavior for
autosave and departure.

The shared Pi runtime installs a manual title task in a hidden conversation scope.
The source is the current editor body, capped at 12,000 Unicode characters and held
only in memory. Native exact-note attachments preserve exclusion/revocation checks.
There are no tools, file writes from inference or chat transcript entries. Pi owns
cancellation, shutdown and abandon-on-restart behavior. Typed titles and body edits
withdraw stale intent; navigation, conflicts and blocked application cannot apply
an old result. The native scope is retired after settlement.

Validation: 247 focused frontend tests pass across Pi integration, title
interactions and architecture ownership. Svelte and E2E TypeScript checks pass.
The production build passes with the existing large-chunk advisory. Four exported
WDIO regressions pass on fresh replay: generation/save with unchanged body and no
visible chat, invalid-output retry, typed-title precedence, and mobile keyboard
activation plus empty-note disabling. Desktop and 390-pixel screenshots were
inspected in session `manual-note-title`; the owned session and server were closed.

Browser verification uses synthetic AI responses and memory-only persistence.
Existing native transport/admission is reused without Rust changes; live provider
quality, credentials and native filesystem persistence were not retested here.
The fixture's known unsupported editor-publication-owner command remains outside
these title UI assertions. Early session failures exposed missing input events
from WDIO's empty clear operation and a Svelte proxy identity mismatch; the test
uses actual typing/deletion, and request identity now uses `$state.raw`.
