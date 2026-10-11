# Local project records

Start here to distinguish current work from development history. Tracker
conventions and retention rules are in [issue-tracker.md](../docs/agents/issue-tracker.md).
Current architecture lives in [ARCHITECTURE.md](../ARCHITECTURE.md), the
[behavior invariants](../docs/architecture/behavior-invariants.md) and [ADRs](../docs/adr/).

## Current investigations and supporting records

- [Chat reliability](chat-reliability/README.md): request latency and citation entailment are open; this index owns the next steps.
- [Context selection](chat-context-selection/spec.md): completed selection work and retained follow-ups. Follow [issue 08](chat-context-selection/issues/08-inline-citation-omission.md) for native citation omissions and [issue 09](chat-context-selection/issues/09-selection-only-answer-scope.md) for answer scope.
- Recent [instruction audit](chat-instruction-audit/spec.md), [context reduction](chat-context-reduction/spec.md) and [tool interface](chat-tool-interface/spec.md) records support those investigations. Their completed steps are measurements, not separate open implementation queues.
- [Gemma implementation](embeddinggemma-2/spec.md): the selected LiteRT implementation and remaining release-validation limits. Earlier runtime experiments in this folder describe their original checkpoints.
- [Transcript recovery](chat-transcript-recovery/spec.md): the retained implementation/recovery contract and bounded verification record.
- [Note formatting on load](note-formatting-load/issues/01-formatting-before-readiness.md): retained issue requiring fresh triage against current code.

Raw chat traces, selected source snapshots and failed runs are retained while the
citation investigation needs them. Generated evidence is local; concise findings
and reproducible fixtures belong in Git.

## Deferred or awaiting fresh triage

- [Architecture cleanup](architecture-cleanup/spec.md): mixed resolved and deferred tickets; older source locations and proposed designs require revalidation. This is not an automatically approved execution queue.
- [Ambient agent](ambient-agent-foundation/astra-planning-brief.md): discovery only.
- [Settings checkpoint](settings-redesign/README.md): further design deferred.
- [Pane animation](pane-animation/validation.md#remaining-profiling): completed corrections with explicitly limited native verification and remaining profiling suggestions.
- [Workspace dock motion](workspace-dock-motion/spec.md), [Atlas research](atlas-research/report.md) and [embedding alternatives](embedding-model-alternatives/research.md): retained planning/research; verify current implementation before reuse.
- [Browser harness results](headless-browser-tests/results.md) and [earlier embedding evaluation](embeddinggemma-2-evaluation/research.md): bounded historical evidence awaiting any further use, not current acceptance gates.

## Completed work and local tools

[Completed-work record](archive/completed-work.md) replaces the redundant completed
specs, tickets, coordination reports and intermediate artifacts. It preserves
outcomes, material validation limits and the Git revision for original records.
Old designs are historical; architectural claims enter current docs only after
checking the current implementation and applicable ADRs.

[Responsive capture tools](responsive-screens/README.md) can generate fresh visual
evidence.
