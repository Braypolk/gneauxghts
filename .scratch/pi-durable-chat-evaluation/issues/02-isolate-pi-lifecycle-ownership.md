# Exclude old lifecycle coordination from the Pi evaluation build

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 01

Follow [the spec](../spec.md). Empty generic tables do not prove replacement:
startup still constructs ChatService, and the Pi frontend proxy can delegate
unimplemented operations to its native implementation.

## Work

- Separate retained settings, composer configuration, grants, exclusions,
  permission decisions, evidence and deterministic proposal policy from legacy
  conversation/run/review lifecycle ownership where needed.
- Compose the evaluation path without constructing the old lifecycle owner.
  Exclude AgentRunCoordinator and the custom Rust model/tool loop from this build;
  remove indirect call paths rather than placing Pi over them.
- Make supported ChatApi operations explicit. Deferred capabilities return an
  unavailable result; proxy fallback cannot invoke legacy coordination.
- Keep Pi authoritative for submissions, entries, tasks, checkpoints and decisions.
  Native effect receipts remain narrowly scoped to canonical mutation.
- Research stays explicitly unavailable until issue 09 provides a Pi worker. It
  cannot keep AgentRuntime compiled as fallback. Extract reusable leaf types/
  utilities only when retained callers need them.

## Acceptance

- An evaluation build compiles without legacy coordinator/model-loop modules and
  starts the real UI; the default build retains its existing path.
- Architecture checks forbid old lifecycle construction/calls and accidental
  fallback. Generic native conversation/run/proposal tables receive no Pi state.
- Settings/access/evidence and Keep use retained services without hidden legacy
  startup recovery or duplicate lifecycle stores.
- Missing capabilities are explicit and cannot reach Rust research. Record
  extracted, excluded and retained responsibilities separately.

## Starting points

`src-tauri/src/{lib,chat,agent_run_coordinator,agent_runtime}.rs`,
`src-tauri/src/agent_tools/research.rs`, native Pi facades,
`src/lib/prototypes/pi/chatApi.ts` and architecture fitness checks. This remains
an isolated deviation from ADR 0001, not production architecture adoption.

## Comments


### Native seam implementation — 2026-10-15

Implemented by `ticket02_native` in the shared evaluation branch. Native acceptance
is still pending; no cargo build or app launch was run by this worker.

- **Extracted:** `chat_domain.rs` owns only provider settings/defaults, local model
  capabilities, unsent composer drafts, note grants and exclusions. It opens no
  long-lived connection and initializes only four retained tables. Existing grants
  migrate without restoring revoked legacy grants on restart. Default `ChatService`
  delegates those operations and retains its cancellation effects.
- **Extracted leaf code:** `provider_config` owns URL/platform validation and model
  metadata/reasoning discovery; `proposal_policy` owns deterministic review-hunk
  validation. Pi's `pi_chat.rs` exposes shared types, citation rendering and structured
  answer validation without default conversation/store/recovery modules. The legacy
  runtime reuses the provider leaf implementation.
- **Excluded from Pi compilation:** `ChatService` and its complete default subtree,
  `AgentRunCoordinator`, `AgentRuntime`, `agent_tools` (including Rust research),
  `AgentPermissionBroker`, guardrails and default chat/proposal command modules.
  `lib.rs` composes `ChatDomain` directly. Only retained domain commands are registered;
  unsupported lifecycle commands cannot dispatch into Rust coordination.
- **Retained effects:** native Pi note/effect facades use `ChatDomain`; ordinary
  forgotten-note recovery/deletion and watcher coordination operate without a chat
  lifecycle owner. Legacy forgotten chats return explicit unavailable errors in Pi.
- **Policy invalidation:** grant/revoke/exclude commands cancel native provider
  dispatches immediately and emit `pi-policy-changed` for Pi-owned task cancellation.
  Evidence/publication boundaries still read authoritative access policy.
- **Restart:** native lifecycle emits a correlated `pi-lifecycle-quiesce` request and
  waits up to 15 seconds for Pi to checkpoint/join and acknowledge. It then stops and
  joins native provider work, revokes SQLite owners, rolls back any uncommitted leased
  transaction, truncates the WAL and closes SQLite before `NoteTimeline.clean_close`.
  An absent or stale acknowledgement from an active owner blocks restart. A
  Settings-only launch with no Pi database owner closes admission directly. Ticket 04 owns frontend closure
  and acknowledgement; ticket 03 owns native provider admission/settlement.
- **Checks added:** `tests/pi_lifecycle_exclusion.rs` resolves the Pi Rust module graph
  with feature/path attributes and checks whole-subtree exclusion, retained schema
  boundaries and shutdown ordering. Unit cases cover retained-table-only startup,
  policy migration/revocation across restart, terminal SQLite revocation/rollback and
  acknowledgement correlation. `rustfmt` parsed the edited native files successfully.

Required acceptance remains both default/Pi compilation, default architecture checks,
focused retained-domain/native shutdown tests and real evaluation UI startup. This
is the isolated experiment permitted by the spec; it does not change ADR 0001's
production ownership decision.

### 2026-10-15 frontend implementation (ticket04_lifecycle)

- Replaced both the evaluation implementation Proxy and outer lazy API Proxy with exhaustive typed ChatApi objects. Retained native delegates are named settings, composer configuration, keys/model capabilities and note-access policy operations; no lifecycle operation can fall through to TauriChatApi. Deferred branching/excerpts/transcript conflict resolution explicitly fail.
- Pi request, conversation, review and answer state stays in Pi records/documents. Frontend quiesce closes watchers and Harness before acknowledging the native lifecycle token; policy-change events cancel active requests across API instances. A failed native restart can reopen a fresh paused Harness through the same caller API.
- Behavioral test proves unsupported operations never call their legacy native counterparts; TypeScript checks the complete interface. Native build/exclusion and shutdown acceptance remain owned by the orchestrator/native ticket02; this comment does not claim those gates passed.
