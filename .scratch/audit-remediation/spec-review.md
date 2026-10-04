# Independent implementation Spec review

Progress: review complete; one actionable finding was fixed by the documents owner and reverified.

Scope: current working tree including untracked implementations against baseline `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`, using `git diff <baseline>` and direct reads. Spec sources: both audits, `findings.json` (153 entries), `plan.md`, module issues/reports, architecture invariants. This is the independent Spec axis requested by root; root coordinates the separate Standards and integrated validation gates. Own frontend changes are excluded from claims of independent review.

## Finding and disposition

**P2, ED05 — persisted task editor lines bypassed verified text targeting.** The original remediation left `openFlow.ts`'s `focusEditorAtDocumentLine(editorLineNumber)` fast path ahead of the new text resolver. Pending task locations survive a route switch; edits may shift/delete a task, and line focus clamps out-of-range values to another line. This violated ED05's requirement to verify current target text and could land on unrelated content despite the new resolver tests passing. Sent to documents owner with shifted/deleted-hint regression request. Owner removed the bypass and unverified section fallback; pending tasks now call the verified resolver with `preferredLine` only as a hint. Owner reports actual-resolver shifted/out-of-range/deleted cases and navigation/openFlow **14/14 passed**, Svelte **0/0**. No remaining actionable finding from the inspected scope.

## Inspected ledger

- Read remediation plan and all 153 finding records for assigned ownership and closure structure. Read documents/editor/harness-documents reports; agent report was actively in progress and is not presented as final verification.
- Deep implementation/call-path review: navigation resolver/openFlow/pending-task storage and task list command admission; editor code-context cache and tests; image upload extraction/cleanup and paste calls; cut shortcut ownership; conflict adoption; counted history restore suppression; proposal orchestration completion joining and workflow transition guards. Proposal replacement is rejected during commit/dismiss, so the shared completion promise did not yield a confirmed cross-review race.
- Deep relevant Rust hunks/call paths: Unicode search span mapping/cropping; asset exclusive-name reservation and failure cleanup; evidence inventory operation-local immutable snapshot and per-use current-content validation; note-catalog pending set lock lifetimes; task projection initialization removal; timeline typed error context; proposal overlap matching/legacy writer removal.
- Sampled, not exhaustive: agent runtime/chat module relocation and tool seams still changing during review; timeline broad migration/fixture changes; native harness and SQL codec broader sets. Final owner checks and root integrated Rust/browser/CI runs are required evidence for these areas.

## Validation and scope notes

Read-only independent review; no full suite or native launch. The root browser log has **4/4 chat controls passed**; its History clear-confirmation interaction initially failed because the clear button was not interactable, reported separately to root/documents. The `findings.json` progress field remained pending while owners were working; that is not an implementation defect. Root must reconcile the final ledger, particularly cross-cut AA12/AA14 rows: the UI report certifies frontend harness/catalog only, and backend module/catalog plus semantic numerical/Atlas decisions require their own owner evidence. No source-length-only rewrite or speculative abstraction was recommended.
