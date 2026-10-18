# Pi Durable native integration prototype

Status: historical; superseded
Date: 2026-10-15
Type: prototype

This is the preserved experiment plan, not an executable backlog. The
[completed native prototype](../archive/pi-durable-native-prototype.md) records
the result and validation limits. The later [accepted ordinary-chat
rebuild](../archive/pi-chat-rebuild.md) superseded the experiment and its adoption
decision under a smaller agreed scope. The instructions below describe the
original experiment; do not execute them as current work.

## Question and authorized direction

How much custom conversation, execution-recovery and pending-approval coordination can Pi Durable replace while chat stays inside Gneauxghts and runs locally on desktop and iOS?

The user authorized an isolated implementation prototype in a new worktree. Pi Durable is the selected experiment. LangGraph is out of scope. Open WebUI is a reference for evidence ideas and interactions only; do not import its code, backend, assets or license obligations. Existing Pi coding-agent extensions are optional reading, not a plugin-host integration deliverable. Use Durable's portable extension API for Gneauxghts capabilities.

This is a native integration experiment, not an HTML state demo or a production migration. Persistence, process termination and WKWebView are the actual questions, so use a disposable native app/vault/database and the existing integration harnesses. Keep the prototype clearly identified, easy to run, and observable. Do not change user data or the ordinary installed app. The prototype is authorized to change experimental ownership within its selected path without asking for another architecture approval; production adoption remains a later decision informed by the result.

## Read first

- `CONTEXT.md`, `ARCHITECTURE.md`, and applicable sections of `docs/architecture/behavior-invariants.md`: request acceptance/completion, interrupted requests, evidence access/freshness, editable review retention, proposal checkpoints/settlement.
- ADR 0001 (app-owned lifecycle), ADR 0009 (retained evidence and history replay), ADR 0011 (chat promotion links), plus other linked ADRs affecting the implementation.
- `.scratch/chat-reuse-research/engine-decision.md`, `pi-mobile-source-findings.md`, `evidence-source-findings.md`, and `pi-probe/README.md`.
- Existing native harness/build instructions and `.scratch/mobile-ios-readiness/remote-chat-validation.md`, `chat-network-review-validation.md`, and `keychain-validation.md`; physical release gate issue 08 remains separate.

Pi pin: published `@earendil-works/pi-durable`, `pi-ai`, and `chord` **1.3.0**, with the research probe's locked artifacts as the initial reference. Source inspection pin is `4954d760504c11df9b2cbdc040346107b6a8153d`, distinct from npm packages. Do not automatically upgrade experimental packages. If an upstream defect requires a version change or small patch, record exact evidence, pin and maintenance cost before continuing; avoid a broad fork.

## Intended ownership

| Concern | Prototype owner |
| --- | --- |
| Sessions, input/task admission, tool/model execution state, committed history, cancellation and safe-task recovery | Pi Durable harness |
| Durable proposal working checkpoint and pending decision | Pi document/task through a bundled Gneauxghts notes extension |
| Native SQLite transactions, provider credentials/network transport, current vault and note services | Rust/Tauri |
| Live editable proposal body/title/hunks and one active review | Existing document runtime and review UI |
| Scope, Note Identity/Revision, citation issuance/freshness, historical proof, admissible model history | Existing evidence/domain services called by the extension |
| Canonical note publication and authoritative mutation receipt | NoteTimeline plus the smallest necessary native proposal commit adapter |

One selected-path durable owner is essential. Do not mirror Pi session/task state into the existing generic ChatService run store just to preserve an interface. Frontend events/projections may adapt Pi committed state. Separate live editor state from its acknowledged durable recovery checkpoint. Retain native publication receipts; an engine checkpoint cannot make a Markdown mutation atomic with the engine database automatically.

This experimental ownership differs from ADR 0001. Record that deviation and its observed benefits in the prototype result; do not rewrite accepted production architecture as if adoption were already decided.

## Scope

Deliver a selectable, opt-in prototype path using existing chat and review presentation. Prefer a single obvious build/run switch and one task-runner entry point; do not add a permanent product settings flow. Use an isolated app identity and synthetic vault through established harness conventions. The default app path stays unchanged during evaluation.

The vertical slice includes conversations and follow-ups, streamed output, one scope-aware read/citation path, Note Proposal create/update, editable review, Keep/Discard, cancellation, explicit retry/recovery, and restart. Include direct Save-to-Note without a model call. Exercise the two existing provider protocols (OpenAI Responses and OpenAI-compatible chat) through deterministic native HTTP fixtures. Live-provider tests are optional only with existing authorized credentials and no new spending/secret exposure; synthetic protocol acceptance must be labeled accurately.

Use Open WebUI's separation of source inventory, model-facing source references, and source inspection as design guidance if it simplifies the slice. Reuse current citation UI where possible; a citation redesign, new retriever/vector store, entailment evaluation project, server deployment, sync, terminal extension loader and arbitrary third-party plugin support are outside this experiment.

Do not migrate old conversations in this prototype. Start fresh Pi-owned synthetic sessions; measure/document the import and compatibility work needed for adoption. Preserve managed Markdown transcript behavior for the slice if practical; otherwise record the omitted behavior as a material adoption cost, not an implicit product deletion.

## Execution sequence

1. [01: Baseline and owner map](issues/01-baseline-and-owner-map.md). Record actual custom responsibilities/call paths before editing. Establish a runnable isolated app and the minimum provider/storage seams.
2. [02: Portable harness and native bridge](issues/02-portable-harness-and-native-bridge.md). Prove Pi can own sessions on desktop and WKWebView using native SQLite, then wire one model turn and read tool.
3. [03: Durable reviewed Note Proposals](issues/03-durable-reviewed-note-proposals.md). Move pending review/checkpoint/continuation into Pi, reusing the real editor and native publication authority.
4. [04: Recovery, parity and deletion verdict](issues/04-recovery-parity-and-deletion-verdict.md). Run the fault/platform matrix, remove any demonstrated redundant prototype-path coordination, and produce a decision with exact retained costs.

Work sequentially across dependent issues. Update issue state/evidence as work proceeds. Keep implementation in the worktree and commit coherent prototype checkpoints there. Do not merge into main, publish, or make the prototype the default. Continue through the authorized checks without asking for routine implementation approval. If a genuine external prerequisite prevents one check, complete independent checks and record the precise limit; do not declare desktop-only results to satisfy iOS.

## Bridge requirements

The portable SQLite facade is asynchronous. Native transactions must survive multiple IPC calls through explicit transaction identity, serialize competing access appropriately, roll back on error/disconnect, and report commit failure truthfully. Avoid leaving unbounded transactions open while waiting for a model or human. Reuse upstream schema/storage semantics rather than designing another generic session database.

Keep credentials in native storage. Pi can use a native single-inference provider adapter or its providers through a native request/stream bridge; choose the smaller proven interface after inspecting the pinned APIs. Do not retain a second Rust agent/tool loop underneath Pi. Verify streaming chunks, tool arguments, terminal state, deadlines and cancellation instead of treating compilation as provider compatibility. Preserve the compatible protocol's single-opening-system-message handling where required.

Expose bounded diagnostic state for the prototype: engine/session/submission/tool/proposal IDs, committed versus transient output, pending decision/checkpoint version, native commit intent/receipt and interrupted outcome. Do not log secrets, hidden reasoning or real vault contents.

## Safety and acceptance behavior

- Admission produces a single recoverable turn; terminal success is announced only after its durable outcome. Provisional structured answer text/sources remain unavailable until admitted by existing validation.
- Current behavior cancels unfinished requests at launch. For the experiment, restore pending reviews, expose interrupted unsafe work, and make model/network continuation explicit. Engine replay may repeat a declared safe tool only when its native operation is idempotent or reconciled. Never silently authorize a new mutation on relaunch.
- Keep alone publishes through NoteTimeline. Bind the decision to the accepted proposal version, payload and target. Discard cannot create/update a canonical note. Duplicate/conflicting decisions and stale callbacks cannot change a settled proposal.
- Retain one globally editable review, queued durable proposals, live document retention, body/title/location/hunk checkpoints, and checkpoint-before-switch behavior. Failed checkpoint blocks handoff without losing text. Direct Save remains deterministic and creates no model run.
- Preserve dirty-editor edits and conflict handling. A changed target cannot receive stale reviewed text; refreshed content requires another Keep. Late refinement cannot reopen a settled proposal.
- Crash after native publication but before Pi outcome persistence must reconcile the native receipt rather than duplicate publication or invent success. A replay-safe flag alone is insufficient.
- Evidence stays bound to issued sources, scope/grants, Note Identity, current hash or retained Note Revision, and exact passage. Recheck current access/freshness on delivery/navigation. Earlier note-grounded assistant prose must not re-enter model history or compaction as evidence.

## Validation matrix and stopping criteria

Use focused executable integration probes for the persistence/platform questions rather than extensive mirrored unit tests or cosmetic polish. Run affected existing checks appropriate to touched contracts.

| Area | Required evidence |
| --- | --- |
| Desktop native app | Real webview → Tauri → SQLite; conversation/follow-up, stream, read/citation, create/update review, direct Save, Keep/Discard |
| iOS simulator | Actual WKWebView on a disposable simulator app; same essential flow and durable relaunch, both provider protocols; build/launch logs and observed UI behavior |
| Review recovery | Edit body/title/hunks, navigate/switch review, checkpoint, terminate/relaunch, then Keep and Discard; failed checkpoint retains draft |
| Fault injection | Terminate around tool intent, pending decision, native commit/receipt and engine outcome; storage failure/rollback, partial provider stream, cancelled/unsafe tool |
| Isolation and races | Two sessions, duplicate decision, concurrent Keep, changed note, late refinement, older callbacks, dirty editor and no cross-session state leakage |
| Mobile lifecycle | Background/foreground and process termination/relaunch; distinguish simulator behavior from physical suspension/memory pressure |
| Evidence/history | Edit/rename/exclude current note while waiting; retained revision links; restored source bindings; safe history/compaction filtering |

Physical-device acceptance is performed if an authorized device is available; otherwise mark it unverified with precise reproduction steps. Simulator success does not establish physical memory, radio, signing/distribution, or background guarantees. A failed iOS gate or bridge defect is a valid prototype result to diagnose and report, not permission to add a server or drop mobile scope.

Stop broadening after the slice resolves the question. Recommend adoption only if it materially retires custom session/review responsibilities without duplicating state and the essential desktop/iOS simulator paths pass. Otherwise recommend a narrower use, defer for upstream maturity, or reject this approach with evidence.

## Deliverables

- Runnable opt-in native prototype, pinned dependencies, one documented run entry point, and synthetic fixtures.
- `baseline.md`: current owner/call-path inventory and check selection before changes.
- `validation.md`: tested revisions/environment/commands, pass/fail matrix, injected-fault evidence and exact limits.
- `results.md`: adopt/narrow/defer/reject recommendation; owner table; functions/modules actually removed or replaced; bypassed-but-retained code listed separately; added adapters/dependencies; net maintenance burden; remaining custom approval protocol; migration cost and upstream issues.
- Worktree commits preserving the prototype and a concise handoff; authoritative production docs remain unchanged unless a clearly labeled prototype reference is needed.

Success is demonstrated simplification and preserved behavior. Passing a fake model, adding wrappers, or a lower line count alone is not sufficient.
