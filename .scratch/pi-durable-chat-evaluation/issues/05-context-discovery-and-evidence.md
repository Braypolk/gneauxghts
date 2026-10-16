# Support normal context, discovery, permissions and citations

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 02, 03, 04

Follow [the spec](../spec.md) and ADR 0009. Composer-supplied active-note context
currently rejects send; discovery/permission UX and historical navigation are absent.

## Work

- Admit open-note hints and selected notes/passages through existing policy.
  Preserve canonical/working-copy distinctions, repeatable explicit references
  and excerpt-only versus full-note scope.
- Expose discovery, reads, temporal/activity and permissions through the bundled
  Pi extension: suggestions, grants/denials, exclusions, versioned cursors and
  explicit unavailable search coverage.
- Persist issued sources/admitted answer bindings with the Pi conversation and
  project normal citation, evidence and read-activity UI.
- Support current passage and retained Note Revision navigation. Revalidate access,
  Note Identity, bytes and change proof at mandatory model/delivery/navigation
  boundaries; ordinary failing hooks are not authorization.

## Acceptance

- Normal send with a note open works; explicit references preserve intended scope.
  Unsaved/pending proposal bytes cannot become canonical evidence.
- Search → permission request → grant/deny → read → citation works in real UI and
  after restart without granting another conversation access.
- Edit/rename/exclude/revoke during inference or after delivery produces correct
  identity resolution or explicit unavailable/conflict behavior. Final inference
  without executable tools still checks current policy.
- Current links focus exact passages; historical links open History Mode. Cleared/
  missing/ambiguous proofs fail explicitly. Unissued references never become guessed
  links or admit provisional structured output.
- Reuse native evidence services; no new retrieval/index system is introduced.

## Starting points

`src/lib/features/chat/ui/ChatComposer.svelte`, Pi ChatApi/notes/provider extension,
`src-tauri/src/pi_prototype_notes.rs`, evidence/context/citation policy and
NoteTimeline's scoped history interfaces.

## Comments

### 2026-10-15 — independent evidence seam implementation

Implemented the reusable evidence/context seam while native composition, provider,
and durable lifecycle integration proceed in tickets 02–04. Native adapters use
`ChatDomain` policy and the existing `EvidenceSession`/`NoteTimeline` services:
canonical reads, scoped current/retained activity, versioned discovery/read cursors,
aggregate evidence allowance, exact selected-range registration, and proof validation.
The bounded native cache contains retrieval capabilities only; expired continuations
fail explicitly after restart. Issued sources, read activity, context hashes and
conversation-scoped permission decisions persist in Pi documents per request.

Automatic adjacent-editor context ignores supplied body/title/path/hash and reads
canonical identity; unsaved or ambiguous selected text never becomes evidence.
Explicit selections preserve exact canonical UTF-8 ranges, including empty lines,
and maintain excerpt-only scope. Retry supplies original canonical context hashes
and refuses changed content instead of silently selecting newer bytes. Native
navigation validates current access/identity/content or retained change proof;
retained sources return the content revision for existing History Mode navigation.
Canonical whole-note read coverage gates replacements and returns the exact verified
raw base hash to prevent a validation/preview race.

Pi tools expose name discovery, canonical search/read, explicit activity intervals,
and durable grant/deny decisions. Discovery previews gain no citation selectors.
Native provider callbacks revalidate context/search versions and issued sources at
model dispatch and final delivery, including source-free/no-tool requests; hook
failure alone installs no provider authority. Full native and real-UI acceptance,
restart journeys and provider journeys remain pending the dependency integrations.

Validation: focused `pnpm exec vitest run src/lib/prototypes/pi/notesExtension.test.ts`
passed 5 tests (retry proof handoff, per-request retention, conversation-isolated
grants, denial/stale identity, read/permission projection). `rustfmt --edition 2021`
parsed/formatted the native adapter. Focused Svelte check reached one integration
error: the shared permission kind needs `noteRead` (assigned to lifecycle/orchestrator).
No Cargo, app, provider, or native acceptance commands were run by this agent.

Follow-up verification after the shared `noteRead` kind landed: Svelte check passed
6,112 files with zero errors/warnings; the focused five evidence tests passed again.
Native compilation and acceptance remain orchestrator-owned and unclaimed here.

### Permission correlation hardening

Permission creation derives its exact submission/conversation/message/run identity
from the one Pi `LiveDoc.run.inputs` entry inside the same tool transaction that
persists the request and per-request evidence. It does not depend on a later
presentation update. Grant/deny settlement rechecks that live input inside its
transaction and rejects changed, settled, missing, or ambiguous runs. Focused tests
now pass 10 cases, including actual tool creation with empty presentation identity,
missing/zero/multiple live inputs and stale settlement. Svelte check passes 6,114
files with zero errors/warnings. Native acceptance remains unclaimed here.

### Canonical title suggestions in normal composer API

The normal Pi `ChatApi.suggestContext` now uses `pi_discover_notes` rather than an
unavailable placeholder. It preserves the title query, excludes the adjacent note
before applying the requested bounded limit, and maps names to suggestions with
empty excerpts and no range/anchor. Suggestions mint neither grants nor read
sources; native global exclusions remain authoritative. The response explicitly
states title-only coverage and requests a narrower query when the native page is
truncated. Four focused tests exercise the real API member, exclusion/limit behavior,
no inferred excerpt/access authority, and empty/truncated results. Combined evidence
and suggestion tests pass 14 cases. Latest Svelte check reports only an unrelated
interactive-probe `vaultAccess: 'selected'` fixture error, reported to the orchestrator;
these suggestion/evidence files have no type errors.

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Native context/policy/evidence services and Pi bindings are integrated. Matrix **P** records selected/current/retained evidence and grants; **M** records actual discovery → Deny, then fresh Allow once → read/citation/canonical navigation through normal local-live UI.

Final race, revocation and platform checks remain open. The paired grant API subset does not establish paired permission-dialog parity. See the [current validation matrix](../validation-matrix.md) for receipt provenance; earlier preparation/typecheck limitations above are historical.
