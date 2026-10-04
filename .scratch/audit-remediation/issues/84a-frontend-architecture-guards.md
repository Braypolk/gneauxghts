# Frontend architecture guard consolidation

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_documents
Findings: H2, FD09, CC01/02

## Plan and acceptance

Inspect all TS architectureFitness and paneCapabilityWiring source guards against real behavior coverage. Retain structural ownership boundaries, parse actual TypeScript declarations/calls/writes/imports with the installed compiler, and remove historical spelling/exact-state-shape assertions whose contracts now have composed behavior coverage. Consolidate pane guards into architectureFitness and remove duplicate file. Mutation probes must demonstrate comments/strings cannot satisfy required calls, reversed comparisons and local aliases are detected, and harmless formatting/comments remain legal. No new dependency. Preserve typecheck. Root owns browser runs; focused Vitest only here. Record exact guard-to-behavior dispositions in harness-documents.md.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
