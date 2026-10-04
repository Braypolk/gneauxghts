# Rendered editor boundary coverage

Status: ready-for-agent
Progress: implemented and verified; final navigation3/3, formatting5/5, unit23/23 and E2E TypeScript passed
Owner: audit_documents
Findings: FE-11, ED05, EH09

## Plan

Existing formatting-load covers headings and restoration but never computed bold/italic/strike styles. Existing navigation test counts effects on mounted first line but never follows a task route to an unmounted destination. Add computed leaf-span style checks on real nested formatted text and a long-note task route case proving destination absent before navigation then visible afterward. Replace ResourceTiming dependency discovery with a small explicit Vite test-module import contract. Bound formatting sampler with an independent timeout, exactly-once cleanup and honest observation window long enough to include intentionally delayed700ms idle parsing; restore idle hooks. Root authorizes isolated browser port1434, native1433 remains untouched.

## Confirmed ED05 ownership defect

Mounted regression selects the correct final task position12490 but stays at scrollTop0. Scoped setter trace shows CodeMirror scroll19312 followed by three lifecycle restore writes0. Same-runtime replaceEditorContentInPlaceForDocument launched settleEditorScrollTop with void, resolving the serialized pane operation before its viewport writes ended. Root authorized bounded fix: await that restoration so subsequent task navigation owns the final viewport. Add completion-order regression; no new queue, timeout or duplicated scroll implementation.
