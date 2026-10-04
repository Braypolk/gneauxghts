# Exercise real agent tools and retire divergent evaluation loops

Status: needs-triage

## Audit sources

reports/backend-agent-and-evidence.md AGENT-01/02/03/04

## Problem and intended result

Tools/research are coupled to AppHandle and context cloning; helper tests replace actual orchestration. Live evaluation implements an outdated second agent loop.

## Acceptance and replacement coverage

Use existing app-owned runtime seam with a deterministic completion model driving real tools against disposable storage. Cover worker authority, cancellation/timeout/lease retry, unread selection, rewrite after partial read and permission revocation. Move blocking work through existing bounded dispatch. Replace/archive duplicate evaluation loop while preserving fixture/results history.

## Constraints and handoff

Preserve ADR 0001 and worker shared budgets versus independent context occupancy. Keep live-provider tests opt-in; never infer production quality from simplified comparator success.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
