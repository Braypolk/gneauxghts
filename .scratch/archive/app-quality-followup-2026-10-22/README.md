# App quality follow-up — 2026-10-22

Implemented the user's selected follow-ups to the [initial quality pass](../app-quality-pass-2026-10-22.md).
The user selected automatic titles for untouched new-note titles with explicit
opt-in. Chat-to-note remains retired. The [research](../../../docs/research/note-taking-friction-2026-10-22.md)
informed the experiments; it does not establish population prevalence.

## Capture and titles

The existing New Idea route remains the capture entry. Dirty body, tags and
focused uncommitted title input now receive coalesced private Recovery Copies.
Failed backups have visible Retry. Interrupted work is offered after startup;
Resume opens a separate draft and backs it up before retiring its source copy.
Canonical notes still require Note Timeline preparation. There is no new global
capture window or bypass writer. Coalescing leaves a 400 ms quiet / 2 s continuous
typing loss window, and storage/OS termination can prevent completion.

Settings → AI & Chat → Automatic note titles defaults off per Running Vault.
When enabled, only a new capture whose title was untouched may request a title
after saving. Input intent wins before blur, and newer edits, external changes,
opt-out, cancellation and workspace disposal reject late results. An admitted
title uses ordinary document title/save ownership. The shared Pi Harness runs
the scoped inference task, without chat history/tools or general filesystem
authority. Native admission reconstructs a bounded saved-note excerpt and
rechecks source/exclusions/opt-in at dispatch and delivery.

`edit_note` already edits complete authored Markdown. This pass fixes removal of
the final unmanaged property, managed-metadata protection, authored-only staging
and creation frontmatter boundaries. Property-only updates also preserve literal
escaped links, so publication matches the exact reviewed authored content. At this
quality-pass checkpoint, the separate filename tool was only
[planned](../pi-note-rename-2026-10-22/spec.md): the then-current single-path proof
and editor leases could not prove safe two-path rename/recovery. The subsequent
[completed rename slice](../pi-note-rename-2026-10-22/README.md) implements
no-replace movement, a separate operation grant, exact destination review,
both-location editor admission and interruption recovery.

Evidence: [recovery](draft-recovery.md), [titles and editing](title-and-rename.md),
[ADR 0013](../../../docs/adr/0013-run-automatic-note-titles-as-scoped-pi-jobs.md),
[ADR 0014](../../../docs/adr/0014-retain-unfinished-work-as-private-recovery-copies.md).

## Retrieval and formatting

Existing passage search already previews and opens occurrences, so it is
preserved. The initial Atlas ranked-row experiment (subsequently rejected by the user
and replaced with map-node filtering; see [follow-up](../chat-title-atlas-fixes-2026-10-22.md)) used admitted map scores, with
keyboard/Enter and pointer opening, previews, reasons and Retry. It reuses the
shared discovery popup and preserves accepted geography.

All-notes queries offer optional All/Notes/Images and Edited Any time/7 days/30
days cues. Admission precedes ranking/limits, changes supersede old requests,
and Retry preserves its request. New queries recompute relative date windows.
No filing or classification is required before capture.

Chat search now adapts shared lexical/semantic ranking while preserving chat
scope, exclusions, query/page limits, canonical proof and source authority. Its
cursor rejects changed rankings rather than silently shifting pagination.
Search previews still issue no read/citation authority.

Formatting now handles backticks inside code spans, empty strike/bold writing,
composition start, and isolated shared Undo for every explicit action. Pointer
marker edges, nested styles, task Enter/exit, reduced motion and shared-pane Undo
were checked. Existing animation timing was retained; shared easing and popup
presentation avoid divergent implementations.

The combined browser pass also exposed two existing interaction defects. File
drops now place the caret at the pointer, preventing an unrelated selection
toolbar from covering upload Retry. Dock content measurements publish in one
cancellable animation frame, eliminating the reproduced compact-resize observer
feedback without changing the animation clock.

Evidence: [Atlas/passages](atlas-passages.md), [retrieval cues](retrieval-cues.md),
[chat ranking](chat-search.md), [formatting](formatting-followup.md),
[browser fixes](browser-followup.md).

## Measured cleanup

Text note/media queries share one exact successful embedding per provider
generation, and ordinary text media calls avoid repeating passage ranking.
Independent modality admission and failures remain intact. Controlled fixtures
reduce paired query work from two embeddings/ranking runs to one; synthetic
provider timings do not establish real-model or WebView latency.

Fingerprinting retains both file-byte scans so watcher-missed edits remain
detectable. Reads move outside the catalog mutex with binding checks around
them. Total isolated fingerprint latency is approximately unchanged; measured
catalog lock exposure falls substantially. No fewer-byte claim is made.

Warm task reads use the AppState-bound indexed lookup for pruning and retain
existing state/projection ownership. First-seen grouping uses indexed lookup.
In one matched debug fixture with 500 notes/5,000 tasks, warm median was
70.408 → 53.809 ms and pruning removed 500 Markdown reads. A 40,000-task/4,000-group
fixture was 560.297 → 56.756 ms. Cold setup showed no improvement. These are
exploratory local measurements, not production/mobile guarantees.

Evidence and reproduction: [retrieval work](retrieval-work.md), [task reads](task-reads.md).

## Validation and remaining evaluation

Focused reports retain their own test counts and platform boundaries. Independent
Standards and Spec reviews found and corrected closed-document retention,
uncommitted-title recovery, stale relative time-window and exact reviewed-content
issues.

Final combined verification:

- Frontend: 143 support tests and 1,606 Vitest tests passed; one test remains skipped.
- `pnpm check`: zero Svelte errors/warnings and passing E2E TypeScript checks.
- `pnpm build`: passed; the existing large-chunk warning remains.
- Native: 688 tests passed; 22 explicit diagnostic/fixture checks remain ignored.
- Architecture fitness: all 19 checks passed.
- Browser: 73 scenarios across all 20 spec files passed on a fresh replay.
- Rust formatting and `git diff --check` passed. Owned browser sessions and
  fixture servers were stopped; temporary screenshots/probes were removed.

Browser fixtures prove mounted frontend behavior against simulated IPC. Native
tests separately prove authority, source admission, metadata and SQLite reopen
ordering. No real native WebView title journey, paid-provider title quality,
physical-device IME/termination or representative personal-vault relevance study
was performed. The existing unsupported fixture publication-owner/mark-opened
commands do not establish native publication coverage. ResizeObserver warnings
were reproduced and corrected; the final whole browser replay records zero such errors.

Use formative delayed-refinding and capture tasks before adopting further
experiments as product defaults. The app still needs no mandatory folders, tags,
inbox processing or map organization to capture and retrieve an idea.
