# Coordinator integration review

Scope: this architecture phase against the working-tree snapshot in `baseline.json`; not the accumulated diff against HEAD. Review is complete; final mounted acceptance is recorded separately. Independent Standards and Spec reports complement this integration inspection.

## Confirmed findings sent to owners

- Proposal replacement ended root review retention without releasing an unreferenced old document. A review can outlive its last pane, so replacing it must release that retained document after preserving any dirty content. Editor owner confirmed and is correcting the terminal/replacement lifetime, including save-before-cleanup.
- Chat first-send continuation reread the selected conversation after awaiting creation. Selection notifications are synchronous and may cause navigation before the continuation, making the current conversation different from the origin. UI owner is verifying and retaining origin identity/selection admission. Completion callbacks likewise must use the admitted conversation rather than a post-notification reread.
- Native live/measurement fixtures still invoked the removed full-record settings command. Independent Standards reviewer found both; coordinator migrated `liveNative.ts` and `chat-typing.spec.ts` to `chat_set_defaults` with visibility excluded. Search of source/native/browser callers finds no old command. Full harness typecheck and native acceptance pending.

## Scheduler inspection

Inspected `SelectedJob` claim/requeue, execution outcomes, producer queue ownership, snapshot debounce and Atlas batches. Unselected maps stay in the queue; only selected documents are cloned for retry. Rebuild subsumes the prior full-scan request; snapshot retains priority before edges. New work wins requeue through the existing merge. Atlas batches preserve iteration over all keys in one category rather than retrying one arbitrary key indefinitely. The direct return replaces result mailbox state. No new generic scheduler framework or runtime owner was introduced. No actionable finding from this inspection; final fixed-source full Rust gate pending.

## Review completion

All confirmed findings above were corrected and independently reread. Additional reviewers caught document-bound reload, repeated reload admission, edited review supersession, occupied-symlink conflict classification and route teardown/remount suppression; all are closed in the linked independent reports and real replacement-owner regressions. Final full frontend1137, Rust746+23 and production/frontend/e2e typechecks pass. Code is ready subject to the final mounted/browser/native gates in validation.md.


Final acceptance completed: all mounted gates described in validation.md have passing results. No confirmed production finding remains open. Initial unreproduced Map/native input failures and restart dependency-server shutdown noise are disclosed rather than attributed to an unproven cause.
