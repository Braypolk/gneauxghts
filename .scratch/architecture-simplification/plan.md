# Production architecture rewrite plan

Progress: Complete. All five designs were persisted before implementation; issues01–08 implemented, independent review findings resolved, and combined/browser/native/restart acceptance completed. See README.md and validation.md for exact results and limits.

## Decisions

1. Replace the Notepad callback graph with a concrete workspace session exposing named user operations. Delete the ten superseded modules, mirrored store interface, nested public transition protocol and caller save/suppression flags. Existing membership, document editing, persistence and rendered editor owners remain authoritative. Owner: audit_documents. Design: documents-design.md; issue01.
2. Finish NoteTimeline ownership of authored publication. Task and proposal callers submit domain transforms/creates and receive authoritative committed outcomes; they no longer handle prepared tokens, watcher correlation, abandonment and finalization. Reuse a private implementation for save/restore while preserving their distinct rename/lineage semantics. No storage format changes. Owner: audit_timeline. Design: timeline-design.md; issue02.
3. Replace semantic drain-all/reconstruct scheduling with claim-one-job execution. Leave unselected work in the existing queue, return job outcomes directly, and preserve newer work on retry. Eliminate cloned deferred batches, seven coordination flags and result mailbox fields. Owner: audit_agent. Design: backend-design.md; issue03.
4. Replace split chat flags/data updates with one aggregate admission transition and controller-owned first send. Preserve the public Readable/snapshot boundary. Follow with separate AppStore-owned snapshot operations and Atlas activation revalidation. Owner: audit_ui_semantic. Design: ui-design.md; issue04 with bounded subissues.
5. Implement document-owned proposal hunk/body state after workspace design agreement. It must eliminate pane/fallback snapshot synchronization outright, with explicit retained document lifetime, effect-only root operations and exact undo/notification behavior. Owner: audit_editor. Design: frontend-alternative.md. Implementation requires the full deletion contract; moving old copies into another class is rejected.

## Scope and coordination

No source edits before the designs are persisted and the coordinator closes the audit checkpoint. Current source snapshot is baseline.json, independent of earlier uncommitted work. Documents owner alone integrates Notepad.svelte; proposal owner supplies agreed integration changes. Timeline owns publication/task/proposal backend; scheduler owns semantic/indexer/mod. Root owns shared architecture documentation, integration, final measurements and acceptance.

Each owner records exact public interfaces/state/protocols removed and replacement dependencies, plus production and test deltas. No LOC quota. If a design adds as much compulsory coordination as it removes, reconsider it before broad migration.

## Verification

Retarget meaningful behavioral tests to the replacement owners and delete superseded shallow-protocol tests after their outcomes have an executable owner. Preserve reproduced regressions. Focused verification first, independent Standards and Spec reviews, combined frontend/typecheck/Rust/architecture gates, then affected mounted/native workflows. Serial browser/native runs; coordinate Cargo compilation to avoid duplicate work and UI timing interference. Record failed experiments and corrections, not just final green runs. Do not claim performance gains without measurement.

## Audit checkpoint and implementation authorization

The coordinator reviewed documents-design.md, frontend-alternative.md, timeline-design.md, backend-design.md and ui-design.md before production edits. All five selected designs have concrete deletion contracts. Accepted alternatives are recorded in those files; generic dispatch/effect frameworks, global actors, alternate storage engines and wrapper-only extractions were rejected. Issue05 first proves retained root review effects/notifications, then removes the old state copies. An additional possible full-record ChatSettings lost-update race will be verified separately before any fix (coordinator ownership); it does not delay the approved rewrites.
