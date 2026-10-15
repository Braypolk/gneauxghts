# Pi Durable native prototype result

2026-10-15. Recommendation: **defer production adoption; retain this isolated experiment**.

Pi Durable 1.3.0 can own local conversations, execution and pending decisions in
actual desktop and iOS WKWebViews. The native bridge and real editor/review
slice work. This does not yet demonstrate a cheaper replacement for Gneauxghts'
complete chat subsystem. Production parity is incomplete, no production module
was deleted, and substantial native/domain approval machinery remains.

See [validation](validation.md) for exact gates and limits and
[baseline](baseline.md) for the pre-change owner map. This is a deliberate,
prototype-only departure from ADR 0001. Accepted production architecture and the
default runtime remain unchanged. Do not merge or enable this branch as-is.

## What the experiment established

- Native asynchronous SQLite IPC supports upstream Pi storage transactions on
  desktop and simulator, with competing operations serialized, rollback, stale
  owner/transaction rejection and committed submission receipts after restart.
- Pi owns the model/tool loop. Native transport performs one inference per call,
  retains credentials, and passes both deterministic Responses and compatible
  Chat SSE protocols, split tool arguments, cancellation and partial failure.
  Final UI answer text is released only after admission.
- The existing ChatApi presentation can project Pi-owned sessions. The real
  CodeMirror review retains edited body/title/hunks through switching and process
  termination, then Keep/Discard settle through Pi tasks and NoteTimeline.
- Model-staged create/update and direct Save work in the measured slice. A failed
  model after staging leaves the review available. Concurrent/duplicate Keep,
  settled callbacks, stale checkpoints, changed targets and access revocation are
  checked. Direct Save has no model execution path.
- No mirrored generic state: the desktop and simulator gates' ChatService conversation,
  message, run, proposal, draft and receipt tables all contain zero rows.

## Final ownership

| Responsibility | Owner in the Pi path |
| --- | --- |
| Submission admission, model/tool task state, committed conversation entries, cancellation | Upstream Pi Harness/SqliteStorage and built-in tasks |
| Presentation metadata, issued evidence and admitted answer bindings | App-defined Pi documents; UI projects their committed state |
| Pending review, working recovery checkpoint, decision and continuation | App-defined Pi `Review` document family plus `ReviewTask` |
| Live body/title/hunks, one globally active review, checkpoint-before-switch, editor adoption | Existing document runtime and proposal orchestration |
| Credentials, one inference stream, native transaction leases | New bounded Rust/Tauri bridge |
| Scope/grants/exclusions, exact evidence freshness, structured answer validation | Existing native domain services, called at mandatory adapter boundaries |
| Accepted-payload intent and replay receipt | New native domain effect ledger; no session/run/decision ownership |
| Canonical Markdown and retained publication/history | Existing NoteTimeline |

## Deletion ledger

**Literal production removals: zero modules, zero functions.** The fallback is
retained for the opt-in comparison. Do not count bypassed source lines as savings.

| Existing machinery | Measured disposition |
| --- | --- |
| `ChatService::admit_request` and generic session/message/run persistence in `chat/store.rs` | Bypassed by Pi submit/entries/receipts in selected path; source retained |
| `AgentRunCoordinator::execute`, `AgentRuntime::run`, Rust model/tool loop and transient run recovery | Bypassed by Pi tasks and single-inference bridge; source retained |
| `ChatService` proposal draft/checkpoint/decision methods in `chat/note_proposals.rs` | Bypassed by Pi documents/tasks; origin deduplication and version policy still custom in the extension |
| Generic native proposal receipt rows | Unused in Pi path; replaced by a separate native effect intent/receipt adapter needed for Markdown atomicity |
| Existing live proposal coordinator, review checkpoints and document registry | Retained and used; Pi does not replace the editable owner or its switching/adoption rules |
| EvidenceSession, citation/structured-answer checks, grants/exclusions | Retained and used; none is a generic engine deletion |
| NoteTimeline preparation/publication/recovery | Retained and used; added a feature-gated pre-reserved creation identity entry |
| Native settings, grants, exclusions and composer drafts | Retained through ChatService; its generic chat rows stay empty |
| Transcript projection/import/relocation, branching and excerpts | Unimplemented in Pi path; omissions are costs, not deletions |

The implementation adds approximately 1,100 lines of application/native adapter
code (including focused native probes), plus roughly 600 lines of disposable
acceptance/build tooling. These are physical line counts of compact prototype
source, not equivalent measures of complexity. Three exact 1.3.0 dependencies
and their lockfile graph are added. No upstream Pi fork or patch was needed.
There is no measured reduction in total maintained code in this branch.

## App-specific protocol that still exists

The extension still implements origin deduplication, draft versions, validation
of title/path/hunks, exact accepted payload capture, decision exclusivity,
conflict refresh, explicit reapproval, source bindings and UI projection. A Pi
background task watches a document until a decision; this replaces generic
waiting/recovery plumbing, not the policy itself.

Canonical publication still needs an intent before file mutation and an
identity-bound native receipt after it. The adapter persists the accepted payload
hash, target, reserved Note Identity and intended editor hash. Replay reconciles
NoteTimeline and native bytes before recording a receipt. Pi's SQLite checkpoint
cannot transact atomically with a Markdown file. The native ledger is a retained
cost, rather than a second generic conversation engine.

Two upstream API details changed the design:

1. Pi hooks report ordinary errors and continue. Throwing `beforeRequest` alone
   cannot enforce authorization. The provider boundary consumes a single-use
   policy, rejects missing permission, validates current evidence/access, and
   admits final text before forwarding success.
2. Task-scoped documents retire when their task settles. Durable review records
   and admitted source bindings must be session-scoped families keyed by task ID;
   task documents alone lost the settled review during the first probe.

Those are pinned API findings, not claims about newer Pi releases. Per-SQL IPC,
lease handling, document-family retention and garbage collection need longer-term
profiling/design before adoption. No latency or memory win was measured.

## Material parity gaps

- Typed prompts and explicit canonical `read_note` IDs form the measured context
  slice. Active-note snapshots, attachments, selected context, web search and
  the ordinary discovery/permission UX are not implemented. Related suggestions
  explicitly return unavailable. Model catalogs are fixed when the harness opens;
  arbitrary later model switching needs more adapter work.
- Managed Markdown chat projections, import of old conversations, branching,
  excerpts, relocation, multi-vault recovery and migration are absent. All Pi
  sessions here are fresh and synthetic.
- Current citations are validated on answer delivery and navigation. Historical
  revision navigation is explicitly rejected by this adapter; retained revision
  proof and rename/edit-during-inference parity remain to be completed.
- Save promotion links are restored after Keep for whole-answer saves, but faithful
  sourced-selection link promotion and existing-note append/heading policies are
  not ported. Targeted Save currently stages a replacement body. It must not be
  treated as the production Save behavior.
- Review title editing is enabled only in the Pi build. Independent update-title
  rename semantics and broad location/refinement behavior are not established.
  The draft stores a location; automatic title-derived relocation is exercised.
- Compaction is deliberately declined/disabled, and earlier assistant/tool prose
  is filtered from model history. This preserves the measured evidence boundary
  but does not replace production long-running research or safe compaction.
- Dirty-editor adoption and failed-checkpoint handoff retain the existing live
  owner and have shared workflow regression coverage. A Pi-specific native UI
  injected-failure/dirty-update matrix is not established. There is no refinement
  tool in this slice, so settled callback rejection is narrower than full late
  refinement acceptance.
- The three publication crash boundaries are measured on desktop. Simulator
  review termination/relaunch and background/foreground are measured separately.
  Physical memory, suspension, radio, distribution and live-provider behavior are
  unverified.

## Decision and follow-up boundary

Keep this as evidence that a portable, local engine seam is technically viable.
Do not begin a production migration from these results. A subsequent explicitly
scoped experiment would need to port the missing context/transcript/history/Save
contracts, prove interrupted and dirty-editor behavior across both platforms,
measure IPC/resource cost, and demonstrate actual deletion of app coordination.
The current evidence does not justify maintaining both paths in the product.
