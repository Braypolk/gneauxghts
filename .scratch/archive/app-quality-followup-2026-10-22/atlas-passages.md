# Atlas route and passage assessment, 2026-10-22

Historical experiment: the user subsequently rejected the ranked suggestion popup.
It has been replaced with map-node filtering; see the [follow-up](../chat-provider-atlas-fixes-2026-10-22.md).
The passage-search assessment below remains applicable.

## Existing behavior retained

Ordinary Search already centers late literal matches, preserves full literal-query
previews when available, opens the matched passage, and supports next/previous
occurrences in this-note mode. Its passage destinations use the existing workspace
navigation and minimal-scroll owner. The previous excerpt experiment and current
behavior invariants support retaining this journey rather than replacing it without
comparative task evidence.

Atlas search supplies note scores and reason labels, not passage locations. Its
input previously highlighted map notes but did not offer Enter to open or a ranked
list. This pass closes that specific navigation gap; it does not claim an improvement
to ordinary Search ranking or passage previews.

## Implemented

- `AtlasStore.rankedSearchResults` derives the visible list from the same current
  response, hit thresholds and score order as map highlighting. A search match
  for an old identity cannot attach to a replacement at the same path. Removed
  inventory rows and weak activity-only scores do not become list results.
- `AtlasSearch.svelte` offers shared note rows with existing map previews and native
  reason labels. Enter opens the active note through the existing pending-target
  route; Up/Down wrap through results. Pointer and focus selection remain available.
  Loading, empty, failure, Retry and failed-open feedback are explicit. Successful
  Retry retains input focus rather than dismissing its own popup.
- The feature-neutral results panel/reveal action now lives under `ui/search` and
  serves both Notepad and Atlas. Existing timing and reduced-motion behavior remain.
- Compact Fit map stays in the bar so the new results cannot cover it. Search does
  not move, regroup, persist or reinterpret accepted map geography.

## Verification

- Atlas store and current-note Search suites: 25 tests passed, including admission,
  removed/identity-replaced inventory, score ordering, compatible retry and unchanged
  coordinates. Shared popup tests explicitly cover reduced-motion opening/dismissal.
- Followed the repository WDIO session loop with disposable session `atlas-ranked`
  and port 1436. Inspected desktop and compact screenshots; exercised keyboard,
  pointer, empty/failure and Retry. Fixed a retry-focus issue found interactively.
- Cleaned exported regression `e2e/agent/specs/atlas-ranked.e2e.js` fresh-replayed:
  3 scenarios passed. It checks rendered coordinate stability, keyboard wrapping/open,
  compact bounds and Fit control reachability, pending rows, empty/error and Retry.
- Closed the owned interactive browser and server. Replay owns and stopped its own
  server. Fixture checks do not establish native window/mobile behavior, real-vault
  freshness, semantic relevance, or passage task success. The known fixture omission
  of `pi_chat_bind_editor_owner` remains visible and was not bypassed.

## Remaining product evaluation

Measure delayed refinding on users' older notes before changing fusion weights,
excerpt generation or adding another passage UI. Compare exact-title recall,
approximate wording, a long note with repeated occurrences, wrong opens, query
reformulation and return to prior editing position. Atlas remains optional; ordinary
Search is the direct passage route. No chat-to-note feature was introduced.
