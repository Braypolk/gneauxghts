# Chat agent runtime

## Decision

Gneauxghts owns its agent runtime and uses Rig 0.41 as an implementation
dependency. The UI and persisted chat model do not expose Rig types. This keeps
the local-first policy, proposal workflow, and provider choices under product
control while still using Rig for model streaming, tool execution, hooks, and
multi-turn limits.

The frontend uses a deliberately small, adapted subset of
[Svelte AI Elements](https://github.com/SikandarJODD/ai-elements): Message,
Chain Of Thought, Checkpoint, Context, Inline Citation, Model Selector,
Sources, Task, Tool, plan, and token-context primitives. The existing chat
controller remains the source of truth. It does not depend on the AI SDK
`Chat` abstraction, and Markdown continues through the app's existing
HTML-disabled renderer. Streamdown, Shiki, and a direct runed dependency are
intentionally not included (the shared `bits-ui` layer may use runed
internally).

## Runtime boundary

`agent_run_coordinator.rs` is the single chat-to-runtime handoff.
`agent_runtime.rs` is the provider-neutral Rig adapter: it accepts an app-owned
request, builds the Rig agent, and emits app-owned events. OpenAI-specific and
OpenAI-compatible local model configuration stays inside that module. Durable
run lifecycle and context assembly remain owned by `ChatService`; Rig types do
not cross either boundary.

The current providers are:

- OpenAI Responses, including hosted web search when enabled.
- A local OpenAI-compatible endpoint, such as LM Studio.

Adding Anthropic, Google, or another Rig provider should add a provider adapter,
secret storage, capability mapping, and settings UI. It must not change the
chat event protocol or Svelte message model.

## Event protocol

Every live event is wrapped with request, conversation, message, run, sequence,
and timestamp identity. The payload is one of:

- `textDelta`
- `toolCallUpdated`
- `stepUpdated`
- `runGuardTriggered`
- `proposalLinked`
- `contextUpdated`
- `planUpdated`
- `usageUpdated`
- `modelTurnRetried`
- `permissionRequested` (transient)
- `permissionResolved` (transient)

Envelopes carry `schemaVersion: 2`. Tool, plan, model-step, and usage events are
stored in `chat_agent_events`. Text remains
durable in `chat_messages.content`, avoiding duplicate token storage. Reopening
a conversation reconstructs `ChatPart[]` by replaying the structured events on
top of the canonical message text. Persisted text deltas are ignored during
replay, so legacy or partially migrated rows cannot duplicate the canonical
answer. Unknown or retired structured variants are also skipped, so an older
projection cannot prevent a vault from opening after an app upgrade. Envelope
target identity, schema version, run identity, and sequence
make duplicate or stale live events idempotent. A correlated live request or
ordered durable replay may explicitly hand a message to a demonstrably newer
run even when omitted text events mean its first observed durable sequence is
greater than one. Once that happens, later events from the retired run are
ignored.

Permission interactions deliberately are not written to `chat_agent_events`.
They represent an in-memory waiter in the current run, so reopening a
conversation must not fabricate an actionable request. The resolved outcome is
kept in the mounted message projection for the rest of that live UI session;
reopening reconstructs only the durable parts and omits it.

`modelTurnRetried` and product-owned guard stops become user-visible status
parts. Tool events contain only bounded input/output summaries and duration,
never raw arguments or provider payloads. Proposal references link directly to
the existing review flow. Durable sources are
materialized as a source part from `chat_sources`, and a completed assistant
message derives its checkpoint part from message status. Those two parts are
projections of their existing durable records rather than duplicate event
payloads, keeping live and reopened messages structurally equivalent.

Cancellation uses a `CancellationToken` and races the next provider stream item,
so Stop aborts the active run instead of merely ignoring later output.

## Run guardrails

Every run has app-owned limits for elapsed time, aggregate model tokens, tool
calls, and repeated identical tool calls. Tool signatures canonicalize JSON key
order while retaining meaningful argument changes such as pagination. Reaching
a limit emits a durable `runGuardTriggered` event and stores a stable terminal
reason plus model-call, tool-call, and elapsed-time metrics on the run. These
limits are independent of Rig's provider loop limit and therefore survive a
future runtime replacement.

## Durable context assembly

Each turn assembles context from four explicit layers: recent canonical chat
messages, a durable transcript compaction, the active note snapshot captured at
send, and note excerpts the user selected for that turn. Older attachment bytes
are not resent; history retains only their names. Compaction rows record the
covered ordinal and transcript hash, and are reused on later turns and after
restart.

Related-note suggestions are local retrieval results and are never silently
included. The composer shows them unselected. Selecting a suggestion creates a
run-scoped note grant, after the backend resolves the stable note ID again,
rechecks global exclusion policy, rereads canonical content, strips frontmatter,
and stores the exact excerpt and content hash in `chat_agent_run_context`.
Retries reload that stored context rather than rerunning retrieval. Global
exclusion always wins over conversation access or a run-scoped selection.

## Plans and permissions

The `update_plan` Rig tool publishes the complete user-visible plan. It is for
progress only, never private chain-of-thought.

The Chain Of Thought component is labeled **Activity** and contains only
observable tool lifecycle. Its rows are concrete, target-aware actions such as
reading a named note, searching for a bounded query, or preparing changes to a
named note; known results include bounded outcomes such as result counts and
line ranges. Rig model turns remain available as internal `stepUpdated` events
for ordering, usage, diagnostics, and guardrails, but are not presented as
user-facing numbered steps. Rig `Reasoning` and `ReasoningDelta` payloads remain
blocked at the runtime boundary; without a provider-safe summary, the app does
not create a placeholder reasoning block.

Completed assistant messages expose a checkpoint action. A checkpoint creates
a new durable conversation, copies transcript history through that message,
copies attachments and sources, records branch lineage, then continues on the
new conversation. It does not mutate or undo the original transcript.

Sources remain durable message evidence. Inline Citation renders stable,
numbered source references from that evidence; persisted web citations decorate
the matching bare or Markdown link in the answer and remain listed in the
Sources disclosure. Note references still open through local note navigation,
while web references use sanitized URLs. Rig 0.41 does not expose OpenAI's
streaming annotation offsets, so the app matches citations to their persisted
URLs rather than patching provider-specific response data into the UI.

Current tools are permission-safe by construction:

- Reads pass through conversation vault access and per-note exclusions.
- Note mutations create durable proposals and cannot write directly.
- A user must explicitly Keep a proposal before the canonical note changes.

Do not add a generic confirmation prompt to harmless reads. Before adding a
tool with a new side effect (shell, network mutation, destructive file action,
or direct write), classify it at the explicit permission boundary described
below.

The permission broker is now the app-owned pre-tool boundary for those future
capabilities. A request is correlated to permission, chat request,
conversation, message, run, and tool-call identity. The backend validates the
entire identity before accepting a decision and resumes a waiter exactly once.
“Allow for session” is intentionally presented as **Allow for this run**: the
grant key also includes the permission kind, tool, and declared scope, and is
discarded on run completion or cancellation. It is never persisted or shared
with another conversation or run. Cancellation and run cleanup resolve pending
waiters as cancelled; duplicate, late, or mismatched decisions are rejected.

No production tool is permission-gated yet. Existing vault reads retain their
conversation access policy, and note changes retain the durable proposal
Keep/Dismiss workflow. A fake test tool proves that Rig's pre-tool hook waits on
the broker before execution without introducing a shell, direct-write, network
mutation, or destructive capability.

## ACP compatibility

The internal protocol is ACP-shaped: stable run/session identity, typed content
parts, tool lifecycle, plans, usage, cancellation, and explicit permission
boundaries. It is not an ACP transport implementation.

Keep domain and UI code on the app-owned protocol. If interoperability becomes
valuable, add ACP as an adapter at the runtime boundary:

```text
Svelte UI <-> app chat protocol <-> Rig runtime
                              <-> future ACP adapter
```

This avoids coupling the product to a transport while preserving a direct path
to ACP clients or external agents later.
