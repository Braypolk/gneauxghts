---
status: accepted
---

# Keep the agent runtime app-owned

Gneauxghts owns the durable chat run lifecycle, context assembly, event
protocol, guardrails, proposal policy, and permission policy. Rig is an
implementation dependency behind `agent_runtime.rs`; Rig types do not enter the
persisted model or frontend interface. This preserves local-first product
control and allows a provider or runtime-library replacement without rewriting
chat history or UI state.

## Consequences

Provider adapters translate through the app-owned runtime seam. Adding a
provider may require credentials, capability mapping, and settings UI, but it
must not change the durable event protocol or Svelte message model.

ACP remains a possible adapter at the same seam rather than the application's
internal transport. Existing read tools use vault policy, note changes produce
durable proposals, and future side-effecting tools declare permissions through
the app-owned pre-tool interface.
