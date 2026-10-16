# Restore supported attachment and web-search workflows

Status: ready-for-agent
Type: task
Milestone: phase-complete
Blocked by: 08

Follow [the spec](../spec.md). Match currently supported app capabilities;
new providers, browsing infrastructure and new file formats are outside scope.

## Work

- Admit attachment bytes/metadata with the Pi turn and preserve exact Retry/reopen
  references under existing capability/size policy. Accepted content cannot depend
  on an ephemeral external path.
- Route supported/forced web search through native single inference and the Pi loop
  with existing provider/source policy. Release initial forced selection for
  subsequent tool/formatter continuation.
- Preserve authored web links and distinctions between web sources, vault evidence
  and unread metadata in UI, history and Save.
- Unsupported combinations are explicit, never silently dropped or delegated to
  legacy runtime.

## Acceptance

- Supported attachment send, follow-up, model change, failure, cancellation,
  restart and exact Retry work through native UI. Failed admission leaves no
  accepted turn missing bytes; unavailable inputs fail clearly.
- Supported hosted web search passes native fixtures and bounded live use;
  unsupported compatible models retain explicit capability behavior.
- Forced search does not prevent later tools/structured completion. Source links
  and selection Save remain faithful.
- No secret/raw attachment payload enters committed diagnostics; no mirrored
  lifecycle rows or second runtime loop appear.

## Starting points

Existing attachment/context admission, capability/web-search policy,
`ChatComposer.svelte`, Pi ChatApi/provider extension and native transport.

## Comments

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Native attachment admission, retained bytes and web-search routing are integrated. Matrix **D** records bounded attachment/web follow-ons within its 23 passed UI checks; the whole expanded desktop run remains failed for its separate strict parent-summary boundary.

The complete both-protocol failure/restart/Retry matrix remains open. Bounded hosted live web is not established and is explicitly user-deferred. See the [current validation matrix](../validation-matrix.md) for receipt scope and remaining native gates.
