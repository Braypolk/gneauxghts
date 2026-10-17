---
status: superseded by ADR-0012
---

# Keep the agent runtime app-owned

[ADR 0012](0012-found-ordinary-chat-on-pi.md) records the accepted new-user Pi
rebuild and its scoped supersessions. The implementation described below is
historical and retired from ordinary chat; it is not a current runtime requirement.


Gneauxghts owns the durable chat run lifecycle, context assembly, event
protocol, guardrails, proposal policy, and permission policy. Provider client/model
construction belongs to `agent_runtime.rs`. Rig messages and usage types cross
the internal chat/runtime interface, but do not enter the persisted model or
frontend interface. This preserves local-first product
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
