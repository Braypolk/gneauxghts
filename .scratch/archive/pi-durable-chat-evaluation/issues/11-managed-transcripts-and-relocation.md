# Project Pi chats into managed Markdown and preserve relocation

> Historical specification/issue record; outside the executable backlog. Original triage/dependency lines are a historical snapshot. See [outcome](../outcome.md).

Status: ready-for-agent
Type: task
Milestone: phase-complete
Blocked by: 08

Follow [the spec](../spec.md), managed projection and Running Vault invariants.
Pi is authoritative; transcripts are derived publication, not another session DB.
Old-conversation import is deferred.

## Work

- Publish Markdown from committed Pi messages/sources/settled origins with identity/
  hash receipts and serialized conflict classification. Later projection failure
  cannot reject an accepted turn.
- Preserve navigation, Save Open in chat, watchers/own-write handling, detached/
  edited/missing transcript behavior and actionable warnings.
- Support moving/reopening the evaluation vault, including Pi location references,
  pending reviews and native intents. Resolve targets through Note Identity and
  the Running Vault.
- Recover Pi-owned state/receipts only. Legacy copied transcripts cannot import
  conversations, grants, attachment bytes or evidence authority.

## Acceptance

- Committed chats produce readable Markdown and valid source/origin navigation after
  restart. Publication failure neither rejects admission nor invents a receipt.
- External edit/delete, watcher races and own writes preserve conflict/detachment
  behavior without overwriting external content.
- Relocation preserves identities/links/true conflicts; interrupted mutations
  reconcile canonical receipts without duplicate publication. Unknown/out-of-root
  locations are not rebound by guessed text replacement.
- Legacy Chats artifacts do not activate old import/startup recovery. Generic
  native lifecycle coordination remains excluded.

## Starting points

`src-tauri/src/chat/{projection,relocation,recovery}.rs`, Pi committed-state
projection and native effect receipts. Extract publication policy without restoring
ChatService lifecycle ownership.

## Comments

### Independent implementation follow-on — 2026-10-15 (acceptance pending)

Implemented the Pi committed-state transcript builder and coalescing publisher,
plus native derived publication receipts, conflict observation/restoration,
explicit conversion through the native NoteTimeline effect boundary, and
vault-identity-bound location mapping. `Chats/Pi/pi-N/Origin.md` and existing
`^msg_pi-assistant-N` Save backlinks remain stable. Legacy transcript recovery
is not imported. Accepted Keep JSON/hashes and native proof tokens/canonical
bytes remain unchanged; location interpretation is native and restricted to
roots previously bound to the surviving vault identity.

Focused TypeScript validation: `pnpm exec vitest run
src/lib/prototypes/pi/transcript.test.ts` passed 6 tests, covering committed
text, provisional structured output suppression, interrupted output, 1,200-turn
history, publication races, and nonrejecting projection failures. Native tests
were added for receipt/classification/recovery, external edit/delete/restore,
own-write observations, inert legacy artifacts, vault identity mapping and an
uncertain Keep across relocation with an intervening ordinary edit. Native
compilation/test execution and integrated desktop/iOS/live acceptance remain
pending; no acceptance or phase-completion claim is made by this comment.

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Committed transcript projection, conflict handling and identity-bound relocation mapping are integrated. Matrix **T** records complete desktop watcher/Save/generated-root relocation/uncertain-Keep slices; **I** records passed iOS watcher external edit/delete and normal Convert/Restore checks.

The whole **I** run failed normal Save editor readiness; corrected Save, selection-B and relocation remain unpassed. Standalone normal Settings vault relocation also remains unproven. See the [current validation matrix](../../../pi-durable-chat-evaluation/validation-matrix.md) for exact scopes; the earlier native-pending implementation comment is historical.

### 2026-10-16 — Final acceptance reconciliation

Implementation is integrated and bounded acceptance is complete under the [root semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json). Retained T/I prove desktop watchers/generated-root relocation/uncertain Keep and clean synthetic iOS transcript/sandbox relocation. Current [v51 desktop](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-O7czrc/desktop-interactive-gate.json)/[v51 iOS](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json), [five iOS boundaries](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-publication-yw2Vaa/ios-publication-fault-gate.json) and [final manual](/private/tmp/pi-v51-manual-acceptance-20261016.json) supplement stable reviewed effects/history/recovery on their own pins.

Material limits: Standalone normal Settings vault relocation remains unverified. Synthetic/programmatic relocation does not establish physical sync/distribution; transcript projection is not another lifecycle owner.

The original triage/dependency lines above are historical; this record is outside the executable backlog. Default production adoption and migration remain deferred.

See [ticket 11 outcome](../outcome.md#ticket-11) for bounded acceptance and material limits.
