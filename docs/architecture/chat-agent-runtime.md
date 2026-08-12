# Chat agent runtime

## Decision

Gneauxghts owns its agent runtime and uses Rig 0.41 as an implementation
dependency. The UI and persisted chat model do not expose Rig types. This keeps
the local-first policy, proposal workflow, and provider choices under product
control while still using Rig for model streaming, tool execution, hooks, and
multi-turn limits.

The frontend uses a deliberately small, adapted subset of
[Svelte AI Elements](https://github.com/SikandarJODD/ai-elements): Message,
Chain Of Thought, Checkpoint, Inline Citation, Model Selector, Reasoning,
Shimmer, Sources, Task, plan, and token-context primitives. The existing chat
controller remains the source of truth. It does not depend on the AI SDK `Chat`
abstraction, and Markdown continues through the app's existing HTML-disabled
renderer. Streamdown, Shiki, and a direct runed dependency are intentionally
not included (the shared `bits-ui` layer may use runed internally).

## Runtime boundary

`agent_runtime.rs` is the provider-neutral boundary. It accepts an app-owned
request, builds the Rig agent, and emits app-owned events. OpenAI-specific and
OpenAI-compatible local model configuration stays inside that module.

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
- `planUpdated`
- `usageUpdated`
- `modelTurnRetried`
- `reasoningUpdated`

Envelopes carry `schemaVersion: 2`. Tool, plan, reasoning-status, and usage
events are stored in `chat_agent_events`. Text remains
durable in `chat_messages.content`, avoiding duplicate token storage. Reopening
a conversation reconstructs `ChatPart[]` by replaying the structured events on
top of the canonical message text. Sequence numbers make duplicate live events
idempotent.

Cancellation uses a `CancellationToken` and races the next provider stream item,
so Stop aborts the active run instead of merely ignoring later output.

## Plans and permissions

The `update_plan` Rig tool publishes the complete user-visible plan. It is for
progress only, never private chain-of-thought.

The Chain Of Thought component is labeled **Activity** and contains only
observable tool lifecycle. `reasoningUpdated` contains lifecycle state and an
optional provider-safe summary. Rig `Reasoning` and `ReasoningDelta` payloads
remain blocked at the runtime boundary.

Completed assistant messages expose a checkpoint action. A checkpoint creates
a new durable conversation, copies transcript history through that message,
copies attachments and sources, records branch lineage, then continues on the
new conversation. It does not mutate or undo the original transcript.

Sources remain durable message evidence. Inline Citation renders stable,
numbered source references from that evidence; note references still open
through local note navigation, while web references use sanitized URLs.

Current tools are permission-safe by construction:

- Reads pass through conversation vault access and per-note exclusions.
- Note mutations create durable proposals and cannot write directly.
- A user must explicitly Keep a proposal before the canonical note changes.

Do not add a generic confirmation prompt to harmless reads. Before adding a
tool with a new side effect (shell, network mutation, destructive file action,
or direct write), add an explicit permission event and scoped decision broker
with allow-once, allow-for-session, and deny outcomes.

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
