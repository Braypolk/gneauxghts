# Optional retrieval cues

Implemented the retrieval-time cue experiment in the existing dock popup. Users
can choose All, Notes, or Images and Any time, 7 days, or 30 days. The date control
is labelled "Edited" with accessible labels "Edited in last 7 days" and "Edited
in last 30 days". It uses saved file modification time, not managed frontmatter
timestamps. No tags, folders, or required filing are introduced.

The controls appear only for a nonempty all-notes text or image query. The
existing current-note search, empty-query Recent/Last edited browser, result
opening, and keyboard navigation retain their owners. A cue click keeps the
input focused; Escape and arrow keys from a keyboard-focused cue return through
the existing input/navigation path. Cue choices remain reversible and last for
the mounted search session, including clearing the query; they are not persisted
as a vault preference.

## Retrieval contract

- Text Notes requests only hybrid note retrieval. Text Images requests only the
  media image channel. All requests both independently; there is no post-filter
  of a limited note result set by whether a note contains images.
- Text media requests explicitly set `includePassages: false`, avoiding work and
  duplicate text results from that channel. Image queries use the native
  `includePassages` and `includeImages` admission switches for the chosen cue.
- Choosing a date computes one cutoff for the current query. Hybrid and media receive the same
  `modifiedSinceMillis` before native admission/ranking. Native tests separately
  cover cutoff admission and independent per-channel limits. Clean current-note
  overrides retain catalog file time; native dirty/pathless current drafts are
  treated as edited now. See [retrieval-work.md](retrieval-work.md).
- Request identity includes result type and cutoff. Changing either retires old
  pending requests and clears incompatible results immediately. Retry keeps the
  exact request cutoff; a new query, replacement image, scope change, or a new
  search after clearing recomputes the relative window without losing the selected
  preset. Any time removes it. Images-only loading waits for the
  actual media response, and filtered empty states explain how to broaden the
  query.

## Verification

- Focused Vitest run: **70 passed** across search store, search IPC, command-bar
  state, and media ranking. This includes independent channels, date propagation,
  image-query switches, stale completion rejection, retry, and media loading.
  Fake-clock tests advance the mounted workspace by days and prove fresh text
  queries, image refinements/replacement, and cleared searches use a current
  relative window while Retry retains the prior request cutoff. This addresses
  the stale-window issue identified by the final independent spec review.
- `pnpm check`: **0 errors, 0 warnings**, including the E2E TypeScript check.
- WDIO session `retrieval-cues` on owned port 1438 recorded, exported, reviewed,
  and replayed as `e2e/agent/specs/retrieval-cues.e2e.js`: **3 passed** in a fresh
  browser run. It covers type/date selection, independent invocations, clear-old-
  results behavior, retry, Any time reset, current-note scope, Recent/Last edited,
  and Escape. Session and owned server were closed afterwards.
- Inspected desktop and exact 390px-viewport screenshots. The compact popup
  wraps the two cue groups and keeps the date options together; it remains fully
  inside the viewport. Final compact screenshot:
  `e2e/agent/.wdio/retrieval-cues-compact.png`.

The browser fixture verifies IPC wiring and UI coordination, not native filtering
of its canned results. Native cutoff/ranking behavior is covered by the retrieval
owner's tests. Browser logs include the existing fixture's unsupported publication
owner command and resize-observer warnings during viewport changes; this is not a
claim of a clean application console. Native WebView/touch-keyboard presentation
and user preference for these cues still need testing on target devices.

Logs: `/tmp/gneauxghts-retrieval-cues-final-tests.log`,
`/tmp/gneauxghts-retrieval-cues-final-check.log`, and
`/tmp/gneauxghts-retrieval-cues-replay.log`. Interactive trace:
`e2e/agent/.wdio/session/retrieval-cues/trace/2026-10-22T19-01-19-045Z/transcript.md`.
