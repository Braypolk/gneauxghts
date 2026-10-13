# Context-scaled evidence allowance

Historical implementation, superseded by [continuous research compaction](continuous-research-compaction.md).
Production no longer applies this cumulative retrieval quota.

October 13, 2026. Follow-up to [research allowance diagnosis](chat-tool-error-details.md).
The previous 24,000-byte retrieval ceiling was fixed independently of the loaded
model window. Parent reads, independent worker reads and the validated handoff
all spent it, so a worker could select a real passage and exhaust the allowance
before returning it.

Parent completion dispatch now uses the existing fresh loaded-capacity probe.
After the usage-context policy's 4,096-token output reserve and 1,024-token safety
margin, half the remaining window is allocated to evidence at one byte per
allocated token. This deliberately conservative byte ceiling is separate from
the reported-usage context guard. Unknown capacity retains the 24,000-byte
fallback. Smaller windows can lower the allowance; capacity refresh never resets
spending. No advertised/model-name window is substituted for loaded metadata.

The evidence owner shares the counter and allowance between parent and worker.
Workers cannot reconfigure it and leave 12,000 bytes for the parent handoff and
follow-up reads. Read pages remain at most 6,000 serialized bytes, including
interpretation guidance. Budget reports use the current allowance, including
search continuations. Read admission sizes remaining-byte integers to their
maximum width so larger allowances cannot undercharge the serialized envelope.
Freshness, independent worker-read requirements and closed selection validation
remain in force.

Reproductions failed before correction: real research orchestration exhausted
the shared allowance before parent delivery, and the production dispatch path
with a 129,280-token metadata fixture still granted only 24,000 bytes instead of
62,080. Both pass after correction. Additional regressions cover a 32,768-token
window (13,824 bytes), unknown capacity, shared spending after capacity shrink or
loss, worker configuration isolation, real paginated reads beyond 24 KB, bounded
pages and accurate remaining-byte reporting.

Validation:

- Evidence filter: 57 passing, 3 opt-in tests ignored.
- Tool suite: 69 passing, 7 opt-in tests ignored.
- Runtime/context suite: 31 passing, 2 opt-in tests ignored.
- Architecture fitness: 21 passing.
- LM Studio reports `qwen3.8-27b-gsq-rco` loaded at 129,280 context tokens. The
  live production runner passed a synthetic-vault read/structured follow-up and
  then admitted 30,000 additional evidence bytes, exceeding the old ceiling.
  This verifies provider compatibility and live capacity wiring; deterministic
  integration tests cover worker exhaustion and large paginated retrieval.
- Whitespace checks and the normal debug native build pass.

The existing aggregate run, context-byte, tool-call, elapsed-time and usage-driven
context guards still apply. Unknown-capacity providers retain the fallback.
The installed application bundle was not replaced; restart the rebuilt
development app to pick up the backend change.
