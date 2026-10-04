# Browser document scenarios and scoped instrumentation

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_documents
Findings: H7, EH08/10

## Plan and acceptance

Split document-and-pane.spec.ts by cohesive independently seeded domains while preserving each existing scenario and assertion. Extract only shared browser primitives; reset localStorage between cases before fresh backend/app initialization. Remove routine success screenshots without an assertion owner. Inspect image-interactions and animation-navigation instrumentation for owned cleanup and bound sampling. Do not edit root-owned paneMotion, pane-animation, chat-pane-animation or timelineNativeMetrics until handoff. Typecheck and inspect scenario parity; root runs browser once integrated. Record scenarios, instrumentation lifetime, and any ownership handoff in harness-documents.md.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
