# Editing Window implementation plan

**Status:** Completed. Issues 36–42 are integrated and validated; the production default uses Editing Windows. [ADR 0007](../../docs/adr/0007-retain-editor-history-at-editing-window-boundaries.md) records the accepted decision; tickets below contain implementation details.

## Behavior

Keep the one-second debounced Markdown autosave. The first changed editor save opens a durable Editing Window. Later saves replace its pending state without extending its deadline. After five minutes, finalize one immutable Note Revision containing the net change.

Example: saved states A → B → C → D become retained history A → D. If the window returns to A, create no new revision. Intermediate states need not remain recoverable.

Coalesce ordinary editor autosaves only. Preserve initial/baseline revisions and distinct task actions, accepted proposals, restores, and external observations. Issue 43 removes old-store compatibility at the user’s request; older stores require a confirmed rebuild from current Markdown.

| Boundary | Action |
| --- | --- |
| Five minutes from the first changed save | Finalize the latest successful save. Saves at or after the deadline enter a new window. |
| Last editing pane leaves the note; History Mode opens; current version is named | Flush the save, then finalize. Naming an existing revision remains metadata-only. |
| Task/proposal/restore/external change; rename/forget/Missing event | Finalize prior editor work, then retain the distinct action or event. |
| Explicit citation request | Finalize only the eligible notes needed for immutable evidence. |
| Clean close or vault switch | Settle publications, finalize windows, then complete the existing portability protocol. |
| Restart after interruption | Recover publications first, validate and finalize surviving windows once, then resume. |
| Clear/reset/purge | Delete affected pending and retained history together; delayed callbacks cannot recreate it. |

App blur, cursor movement, health polling, and background chat loading do not finalize windows. No additional idle timer is needed.

The detailed [capture contract](../../docs/architecture/editing-window-contract.md) fixes deadline admission, interval evidence, recovery, and receipt retirement. The integrated default now selects window capture; [release acceptance](../../docs/architecture/editing-window-release-validation.md) records completed correctness/storage/native gates and explicit measurement limits.

## Design

`NoteTimeline` owns capture, deadlines, and recovery. The frontend keeps its existing autosave and workspace ownership.

Keep three storage concerns separate:

- **Publication intent:** durable recovery evidence prepared before each Markdown write.
- **Pending window:** one replaceable compressed authored state per note, anchored to its preceding finalized revision. It has no public Revision Identity.
- **Finalized revision:** immutable, reconstructable, nameable, and citable.

Finalization atomically appends the net delta against the **finalized anchor** and removes the pending window. Never depend on an overwritten intermediate state. Distinguish the latest captured canonical state from the latest finalized revision in hash checks and provenance.

Bound per-save completion records as well as revision rows. Retain pending, live, and referenced receipts; retire unneeded terminal records with tested retry/stale-token semantics. Otherwise database growth would still track autosave frequency.

Backend deadlines use the existing mutation barrier and generation checks. Test clock changes, suspension, concurrent saves, failed finalization, and deletion races. Preserve mandatory preparation, committed-result warnings, exhaustive integrity validation, and retryable recovery.

Show one selectable entry and combined diff per finalized window. Keep action revisions individually selectable. Citations reference only finalized revisions; provenance reports changes within the window’s time interval without inventing exact introduction or retyping times.

## Implementation order

Each ticket depends on the previous one.

| Ticket | Work |
| --- | --- |
| [36](issues/36-define-editing-window-contract.md) | Define boundaries, time evidence, receipt rules, and revised spec/architecture contracts. |
| [37](issues/37-persist-pending-editing-windows.md) | Add pending storage, atomic finalization, bounded receipts, with durable publication receipts. |
| [38](issues/38-capture-editor-saves-in-windows.md) | Route editor saves through windows; preserve action attribution and external observation ordering. |
| [39](issues/39-coordinate-window-deadlines-and-lifecycle.md) | Integrate deadlines, navigation, recovery, close, and deletion. |
| [40](issues/40-preserve-window-provenance-and-citations.md) | Update provenance, activity queries, citations, and shared contracts. |
| [41](issues/41-show-one-diff-per-editing-window.md) | Replace new-history revision groups with one entry and combined diff per window. |
| [42](issues/42-validate-editing-window-storage-and-release.md) | Validate storage reduction, correctness, and native performance before enabling the complete policy. |

## Acceptance

- 300 changed saves within one uninterrupted window produce **one** new finalized revision and bounded bookkeeping. Twelve windows produce twelve revisions, absent earlier boundaries. Use a fake clock.
- Failure, unsupported-schema rejection, deadline, multi-pane, clear/purge, and restart tests preserve exact canonical bytes, immutable citations, and exactly-once recovery.
- Compare identical production-write workloads: retained rows, payload/index/database/WAL bytes, save/finalization latency, cold recovery, and responsiveness while typing. Fewer rows alone do not prove lower write I/O.
- Retain the approximately 250 ms native paging/diff and sub-second reconstruction/restore targets. Use disposable current-schema window fixtures; preserve historical measurements.
- Complete regression suites and Standards/Spec review; preserve failed measurements in a new validation report.

Follow-up [issue 43](issues/43-remove-granular-editor-history-compatibility.md) removes granular Editor compatibility, old-store migrations, and grouped navigation. Its scope supersedes the earlier preservation promises; issues 36–42 and their release reports remain historical implementation evidence.
