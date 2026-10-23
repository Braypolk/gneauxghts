# Rebuild ordinary chat on Pi

Archived agreed scope, completed 2026-10-16. All ten tickets are implemented;
see the [final outcome](pi-chat-rebuild.md). This is historical scope, not a new
execution queue. User-requested iOS acceptance was simulator-only.

Status: completed; accepted for the agreed desktop and iOS simulator scope.
Historical approved scope; see [consolidated outcome](pi-chat-rebuild.md).
Approved: 2026-10-16, after the scope interview and final user confirmation.

## Objective and starting point

Build the simplest useful Gneauxghts chat with Pi as its foundation. Replace
ordinary chat for new users; do not reproduce the old runtime behind a compatible
interface. Temporary feature loss is intentional. Keep one shared implementation
for desktop and iOS, establishing the design on desktop before full iOS acceptance.

Pi owns conversations, immutable history, submissions, generation/tool tasks,
scheduling, follow-up queues, cancellation, task recovery, progress, usage and
compaction. Gneauxghts supplies presentation, native transport/storage integration,
vault authorization, note capabilities, citation admission and canonical publication.
Prefer installed Pi mechanisms and supported extensions over custom lifecycle code.
The current dependency starting point is Pi Durable/Pi AI/Chord 1.3.0; inspect the
actual pinned APIs before implementation. A dependency upgrade needs a concrete
reason and validation, not an assumption that another version supplies a seam.

The user approved this plan, then authorized implementation by a new orchestrator
in this same worktree using fresh-context subagents and dependency-aware parallelism.
See the [final outcome](pi-chat-rebuild.md) for implementation and verification results.

## Architectural changes to record

This plan deliberately contradicts the runtime ownership and fixed frontend
contract in [ADR 0001](../../docs/adr/0001-keep-agent-runtime-app-owned.md).
Ticket 01 records the new decision and its implementation sequence. Do not silently
carry forward incompatible requirements or declare unimplemented ownership current.
Read [architecture](../../ARCHITECTURE.md), [domain language](../../CONTEXT.md),
[behavior invariants](../../docs/architecture/behavior-invariants.md), and relevant
[ADRs](../../docs/adr) before changing their owners.

| Concern | Intended owner |
| --- | --- |
| Generic chat execution, history, task state, recovery and compaction | Pi |
| Model protocol and streaming mechanics | Pi AI through narrowly justified native transport |
| Chat presentation and workspace integration | Svelte consuming Pi views/events; existing visual components may be reused |
| Read/write authorization and exclusions | Gneauxghts domain policy, applied at native capability boundaries |
| Read-source identity and citation validity | Gneauxghts native note reads and a small citation adapter |
| Canonical notes, Note Identity and Note Timeline | Existing native NoteTimeline |
| Uncertain external write effects | Native publication proof/receipts reconciled by Pi-owned tasks |

No second ChatService lifecycle mirror, generic application scheduler, frozen
history copy per request, custom summary engine, or durable UI projection store.
App-specific Pi documents/tasks are allowed when they represent necessary domain
state, not merely to reproduce the old architecture. Record what each one earns.

## Initial user experience

- Ordinary Markdown answers, streamed answer text, collapsed-by-default
  provider-emitted reasoning, expandable tool details and structured citations.
- Activity shows observable model/tool/compaction states, actual useful tool
  errors and elapsed time. Do not invent thinking or stuck diagnoses.
- New conversations, list/switching, persisted history, Stop and an explicit
  new-attempt action after terminal failure. The new attempt need not reproduce
  the old request's exact settings/history, and must not be labeled exact Retry.
- Pi's built-in follow-up queue, visible queued messages and cancellation before
  execution. Switching chats does not stop work. Independent conversations use
  Pi scheduling without an additional global worker pool.
- Native vault search/read and explicitly attached notes. Attachments are note
  identities resolved through current authorization, not arbitrary file uploads
  or unsaved editor snapshots.
- Settings define the default read mode. Initially Full vault; Attached notes
  only is the restricted mode. Exclusions always apply, including to attachments.
  Permitted reads need no repeated confirmation. Defaults apply to new chats;
  existing chats retain their explicit mode until changed.
- The configured local model must pass real acceptance with tools, streaming and
  compaction. Hosted OpenAI is available through the same integration; hosted-only
  features, broader provider expansion and live hosted credentials are not gates.
- No unsolicited inference except necessary Pi compaction. Initial titles derive
  from the first message. No background suggestions or research.
- Keep the familiar overall appearance without preserving the old ChatController,
  ChatApi, event protocol or persisted chat model as compatibility requirements.

## History, citations and access changes

Pi's standard history and compaction may retain earlier tool results, reasoning
and answers as working memory. A note edit does not erase that historical content.
Claims about current note state require another read; a summary is neither new
evidence nor permission. Use Pi's normal storage/events for reasoning, with no
separate durable store or legacy transient-only reasoning channel.

Citations use structured source IDs bound to notes and revisions actually read.
Validate IDs in the app, link to the note/read revision, distinguish historical
content from current content, and reject invented IDs. Search previews alone do
not authorize citations. Exact passage highlighting and semantic entailment checks
are deferred. Mere later edits do not invalidate an honestly historical citation.
Do not invent a finalized Note Revision for an in-progress Editing Window; bind
the source to the actual native read state and explain any navigation limitation.

Restricting read access or adding an exclusion retires affected in-flight authority
and ends the old model context. Start a fresh conversation under the new scope;
old history can remain human-visible but cannot feed the restricted context or
silently restart under old authority. Do not implement custom history redaction.
Stored history is display state, not authority to fetch excluded current content.

## Write foundation and future settings

Initial product chat is read-only. Its build exposes no model mutation capability;
user-facing write settings and editable review UI ship with future write features.
The foundation must nevertheless prove real synthetic create/update operations
through authorization, NoteTimeline and crash/recovery paths, not mocked writes.

| Future setting | Agreed semantics |
| --- | --- |
| Off | No model-driven mutation |
| Temporary | Grant belongs to one conversation, survives reopening/restart, and ends on revocation or conversation deletion; new chats never inherit it |
| Always | Configured scoped authority persists for the Running Vault until revoked |
| Review before applying | Independent policy, enabled by default; disabling it permits direct writes only within an explicit valid grant |

Read access never implicitly grants writes. Grants identify allowed operations and
explicit notes/folders; exclusions and current eligibility still apply. An approval
cannot authorize a changed payload or widen scope. Persist domain state using Pi
facilities where suitable, but native execution must validate authority rather than
trust model-supplied flags, paths or identifiers. Do not create competing grant owners.

Create/update are the only executable write operations in the initial proof.
Use typed operation admission that can later add rename, move, delete, property
changes and Version Restore independently. Do not prebuild those implementations,
a universal filesystem executor or a speculative plugin framework.

Changed canonical content or dirty editor content stops a conflicting mutation.
Require a fresh read and another authorized attempt; no silent overwrite or merge.
NoteTimeline remains the canonical mutation/history owner and normal editor adoption
remains operation-specific. Pi recovery does not guarantee exactly-once external
effects: reconcile lost acknowledgements and existing publication proof before
another write. Revocation stops new effects without pretending an already published
write was undone. Tests cover review-required and explicitly authorized direct modes.

## Recovery and platform behavior

Resume pending Pi work automatically on reopen while its persisted authority remains
valid. Explicitly stopped work stays stopped; terminal failures require a new attempt.
Default Pi tool replay semantics apply. No blind replay of an uncertain mutation.
Use supported Pi recovery, ownership and commits rather than another run coordinator.

Keep WebView-compatible Pi plus native Rust integration for both platforms. No Node
sidecar or desktop-only replacement. Native SQLite retains atomic transactions,
owner lifetime, rollback, durable commits and orderly close/checkpoint behavior.
Reuse verified pieces of the current adapter where they earn their place; do not
copy its surrounding evaluation orchestration wholesale.

Desktop establishes the design and required local-model journeys first. Ticket 10
then validates simulator suspension/recovery. The user subsequently limited this
rebuild to simulator acceptance; physical-device validation is deferred, not a
completion blocker, and must not be claimed from simulator results.

## Intentionally dropped requirements and reset boundary

No existing-user migration, integration with old chat state, exact Retry, managed
Markdown transcript publication/import, editable Note Proposal UI, research workers,
plans, implicit editor context, selected excerpts, non-note attachments, branching,
archive workflows or manual compaction UI. No obligation to retain legacy tests
whose sole purpose is enforcing those intentionally retired contracts.

Use a fresh chat store and new-user assumption. This is not authorization to delete
ordinary notes, Note Timelines, provider credentials/settings or arbitrary transcript
files. Do not design migration/reconciliation for old chat users. Test fixtures and
destructive cleanup use generated/disposable data. Original user vaults remain outside
automated destructive acceptance. Existing domain services are reusable product code,
not an old-chat compatibility layer.

## Tickets and execution order

| Ticket | Deliverable | Depends on |
| --- | --- | --- |
| [01](pi-chat-rebuild.md) | Architecture decision, owners and small domain interfaces | None |
| [02](pi-chat-rebuild.md) | Ordinary chat composition, native storage/transport and settings | 01 |
| [03](pi-chat-rebuild.md) | Messages, reasoning, Activity, queue and lifecycle UI | 02 |
| [04](pi-chat-rebuild.md) | Native search/read, note attachments and read authority | 02 |
| [05](pi-chat-rebuild.md) | Structured read-source admission and note/revision links | 04; coordinate 03 |
| [06](pi-chat-rebuild.md) | Built-in Pi compaction with minimal domain integration | 02; coordinate 04/05 |
| [07](pi-chat-rebuild.md) | Durable scoped authority and real synthetic create/update recovery | 02; coordinate 04 |
| [08](pi-chat-rebuild.md) | Desktop local-model and failure acceptance, diagnostic measurements | 03–07 |
| [09](pi-chat-rebuild.md) | Complete default replacement, deletion and backlog reconciliation | 08 |
| [10](pi-chat-rebuild.md) | Simulator acceptance after desktop design; physical device deferred | 09 |

Tickets 03, 04, 06 and 07 can progress in parallel after 02. Agree shared interface
changes before editing shared composition code. Citation work follows real read
bindings. Read-only ordinary chat becomes the implementation route during the
rebuild; do not ship a permanent opt-in lane or runtime fallback. Ticket 09 removes
the superseded machinery after integrated desktop proof, then repeats affected checks.

## Acceptance and performance evidence

Required outcomes: reliable local chat, useful streamed progress, structured
citations, authorized reads, queue/Stop, reopen/recovery, long-conversation standard
compaction and real synthetic create/update with correct review/conflict/recovery.
Follow the ticket-specific behavioral checks and applicable repository checks.

Measure model time separately from admission/settlement/presentation, bridge calls
and bytes separately from internal SQL, and database bytes separately from WAL/SHM.
Investigate unexplained resource growth across representative short/long conversations.
Record dependency/build pins, failed runs and real-native versus synthetic evidence.
Old polling-asymmetric ratios are historical observations, not acceptance thresholds.

Measurements guide this rebuild. Do not make numerical budgets final authority,
add permanent runtime caps to satisfy them, freeze bridge-call counts in tests, or
promote temporary targets into architectural invariants. Retain useful diagnostic
evidence without turning it into a mandate for future changes. Do not add a benchmark
subsystem whose maintenance is greater than its demonstrated value.

## Previous backlog disposition

The [portable overhead plan](../pi-durable-chat-evaluation/cost-investigation.md) is superseded as an
executable backlog. Its measurements remain supporting evidence, not current scope.
Baseline/projection/lifecycle/progress/compaction concerns are covered by tickets
02/03/06/08/10. Prepared-statement caching and bridge batching remain conditional
implementation choices after evidence. Exact-Retry history migration is dropped;
do not implement it for this new-user rebuild. Ticket 09 reconciles any remaining
legacy references without rewriting historical evidence as current architecture.
