# Remove redundant browser instrumentation and structural shape checks

Status: ready-for-agent
Progress: Complete; implemented, reviewed, and accepted after combined validation. See ../validation.md.
Owner: coordinator

## Reviewed deletions and retained protection

- Delete browser navigation's first test that patches EditorView.dispatch, DOM scroll methods and matchMedia to count two internal scroll effects. It does not measure reduced-motion paint at all. Actual offscreen task-route reveal now owns browser navigation outcome; navigation.test.ts owns full-document matching, and pane-animation owns actual reduced-motion layout. Retain the offscreen race regression and Atlas camera/hover boundary (no equivalent real-renderer owner).
- Fold Clear-history cancel/no-write confirmation into the existing browser paged-history clear/return journey and delete the separate duplicate mounted clear scenario. Preserve exact canonical clear arguments and read-only/focus/scroll outcome. Keep separate sticky naming identity and pending restore interaction cases.
- Reduce identical pane open/close matrix from900/1440/2400 to900/2400: default1440 opening, interrupted close and native pane tests remain; both left/right and narrow/wide boundaries remain. This primarily reduces duplicate expensive browser execution, not a claimed LOC reduction.
- Drop three TypeScript AST tests pinning full document field lists/readonly syntax, presence of reducer call names, and exact forbidden readiness identifiers. Types and actual document/reducer/pane lifecycle outcomes own those contracts. Retain architectural owner duplication, History separation, external-sync write routing, and capability-bypass checks plus scanner controls. This avoids freezing internal layouts merely because the old implementation used them. Update architecture wording to describe the remaining guard scope.

No production behavior changes proposed. Before/after will include browser test code removed, setup interception concepts removed, remaining fixture/guard cost and actual focused validation. Unique geometry, canonical persistence, IPC dispatch and reproduced navigation races remain.

## Independent deletion review correction

The deleted Clear scenario waited for the canonical post-clear baseline; the retained journey had already exhausted paging, so its old Load-older-absent wait was vacuous. Transferred the specific baseline-row wait before state/argument assertions, preserving completion rather than relying on click timing.

## Browser verification correction

The first combined browser run caught an overly broad replacement in the prior wait correction: the post-clear baseline wait had also replaced the earlier pagination wait, before Clear was invoked. Restored the earlier Load-older-absent wait after loading the final page; retained the canonical baseline wait only after Confirm Clear. This is a test edit error, not a production History defect. Eight other files passed. Rerun the changed History file after correction; retain the initial failure log.
