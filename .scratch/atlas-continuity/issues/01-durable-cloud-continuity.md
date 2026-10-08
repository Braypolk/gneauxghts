# Persist cloud identity and admit continuity atomically

Status: ready-for-human
Type: task

## Outcome

Cloud IDs, anchors, lineage, evidence and future user names survive restart and
derived-cache rebuilds. Only admitted map generations become continuity inputs.

## Work

Follow [the spec](../spec.md), especially durable-head publication. Introduce
private continuity calculation/storage modules behind the semantic Atlas owner;
bind the vault-local metadata path at composition. Keep the current worker queue
and visibility variants. Internally key ordinary notes by Note Identity, retaining
path-based response compatibility. Allocate opaque cloud IDs and carry colors.

Import the latest valid published map once. Version metadata and keep a prior
recoverable generation. Write artifacts/metadata before the authoritative head;
repair derived ready pointers only to the head's admitted generation. Include
cache-clear, artifact GC and semantic-provider recovery in this contract. Remove
pre-admission position writes as continuity authority. Add serialized admission
for subsequent cloud-name operations without holding locks during calculations.

Document the storage/publication decision in an ADR, architecture map and behavior
invariants. Preserve unrelated working-tree changes.

## Acceptance and verification

- Reload/restart retains IDs, colors and anchors; legacy migration is idempotent.
- Path rename preserves ordinary-note continuity by identity; fallback rows never
  infer identity by a title match.
- Failed/superseded jobs and repeated polls do not alter accepted continuity.
- Crash injection around each commit stage recovers one consistent map head;
  cache clear never loses map metadata or names.
- Provider changes cannot compare incompatible prototypes; variants are isolated.
- Corrupt metadata remains recoverable and produces explicit failure.
- Extend publication and storage tests through the real owner seam; run relevant
  Rust Atlas tests, formatting and architecture checks.

## Implementation — 2026-10-07

Durable variant heads, opaque IDs, last-valid recovery, guarded publication and legacy import are implemented. Native worker and double-failure recovery regressions pass. ADR 0010 records the storage boundary.

See [evaluation and limitations](../evaluation.md).
