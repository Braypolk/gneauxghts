# Unified existing-note write permission

Completed 2026-10-22 at the user's request following the [interface review](research.md).
This outcome supersedes the initial independent Rename permission in the historical
[Pi rename outcome](../pi-note-rename-2026-10-22/README.md).

## Result

- Chat and Settings share one existing-note permission for content, authored
  properties and same-folder filenames. Creation remains a separate opt-in.
- `edit_note`, `rename_note` and `create_note` remain separate model tools, backed
  by the existing shared publication task and native owner.
- Update grants admit edits and renames under the same note identity or allowed
  folder scope. All enabled folder grants include descendants.
- The normal default-on review setting applies to newly prepared renames; exact
  path review remains available. Already prepared intents retain their requirement.
- Saved grants using the retired `rename` spelling read as `update`; duplicates
  collapse. Existing chats and vault defaults reopen without a reset.
- Exact reads, unchanged bytes/identity, no-overwrite publication, durable two-path
  proof, stale-save guards and editor adoption/recovery remain enforced.

Current policy lives in [ADR 0015](../../../docs/adr/0015-prove-agent-renames-across-both-locations.md),
[behavior invariants](../../../docs/architecture/behavior-invariants.md#agent-publication)
and [ARCHITECTURE](../../../ARCHITECTURE.md).

## Validation

- 131 focused frontend tests across authority, tools, publication, Settings
  discovery, architecture and IPC contracts passed.
- 36 native authority/publication tests and 19 backend architecture checks passed.
- Eight native rename scenarios passed against this worktree's pinned debug build:
  Off denial, unified permission with review disabled, exact review/discard,
  descendant scope, collisions before/after review, identity/history/citations,
  editor-adoption retry and split-pane stale-path save protection.
- Five browser cases passed in a fresh replay: exported unified Chat/Settings
  controls and four folder form cases, including stale revisions, native errors,
  cancellation and 390px viewport containment. Named session `unified-write-1458`
  captured and inspected Chat/Settings screenshots; session and owned servers closed.
- `pnpm check`, production build and `git diff --check` passed. The build retains
  the existing large-chunk advisory.

Original permission-pass artifact: `src-tauri/target/e2e/debug/gneauxghts`, SHA-256
`e5f2e3187e00fd737779adacf780a1196c384ee75cee70a7c94dc9b5086ca81f`.
The native suite used isolated app data and a disposable vault, with a synthetic
model protocol. This does not measure live-model tool selection. The browser IPC
fixture is memory-only and cannot establish persistence across a page reload;
its saved-form check remounts through navigation, while native tests verify store
reopen. Initial browser assertions assuming fixture reload durability and a fixed
operation ordering were corrected before the passing replay.

## Tool cleanup follow-up

Implemented the user's next two simplifications, with the identifier decision
corrected against Pi's installed implementation:

- The publication extension supplies one shared mutation policy for editing,
  creation and renaming. Tool descriptions and sections retain only their
  operation-specific behavior. Instructions no longer ask the model to invoke a
  reconciliation API it does not have. Uncertain effects still forbid a new
  request, and native reconciliation remains unchanged.
- Native preparation returns a tagged update/create/rename result. Create and
  rename previews are required by their respective frontend types. The durable
  publication task carries an explicit write/rename effect, so its live, cancelled
  and recovered execution paths no longer infer renaming from an optional path.
- Publication task version 4 upgrades pending version 3 inputs once, retaining
  the original native intent, review hash and checkpoint. Reopened reviewed writes
  and renames publish only their original effect, once. Earlier versions remain
  unsupported.
- Both existing-note tools keep `noteId` plus `expectedReadSourceId`. Pi's explicit
  file path supports retaining an explicit target; this app additionally requires
  exact-read freshness. The receipt-only proposal is withdrawn in the
  [source comparison](research.md#follow-up-explicit-targets-and-read-receipts).

Follow-up validation: 118 focused frontend tests (including hosted/local wire
schemas, shared prompt assembly and version 3 review-task upgrades), 29 native
publication tests, 19 native architecture checks, `pnpm check`, the production
build and `git diff --check` passed. The build has the existing large-chunk
advisory.

28 native application scenarios passed: eight rename, nine editing, four creation
and five publication cases, followed by the two opt-in pending edit/create
process-restart checks. The creation check also restarts after commitment to
verify only one note remains. The unrelated opt-in Temporary-grant process-reopen
case was not enabled. All runs used this worktree's pinned debug app and disposable
app data/vaults; owned processes and servers were closed.

Follow-up artifact: `src-tauri/target/e2e/debug/gneauxghts`, SHA-256
`d661728801d42948855498db45b8ab192bc40a55f9b5adc0b34c36455686f835`.
Version 3 input upgrades were tested through Pi's real scheduler and MemoryStorage;
actual process restarts exercised version 4 tasks. No cross-binary SQLite upgrade
or live-model tool-selection benchmark was run. Scripted model responses verify
tool and publication integration, not whether a live model chooses tools better.

## Final review cleanups

Removed the unused `adoptReconciledAgentPublication` wrapper, its exported document
capability and tool-fixture stubs. Document admission tests now use the same
reconciliation lease and `lease.adopt` interface as production. Removed the
redundant `confirmedUnpublished` flag and unreachable retention branch; uncertain
rename proof still retains its lease, while confirmed-unpublished cancellation
releases it.

Validation: all 111 tests across edit, rename, publication and document publication
admission passed. `pnpm check` passed with zero errors/warnings, including the E2E
TypeScript check, and `git diff --check` passed. No native or interactive suites
were rerun for these frontend-only removals.


## Merge-readiness recovery correction

The readiness review found that a failed native rename proof could retain the
editor lease after the Pi task ended without exposing a recovery action. The
publication owner now retains an uncertain original intent as well as a proven
committed receipt. Both have a visible Retry outside the paused workspace.
Retry joins active publication/cancellation and pending native admission release,
then reconciles the original intent without invoking publication. Confirmed
non-publication releases the pause; a proven commit refreshes editors; unavailable
proof remains actionable. A known committed receipt cannot be downgraded.

Three scheduler-backed regressions reproduced the missing recovery state before
the correction and now verify committed, unpublished and blocked outcomes, a
failed retry, concurrent retry coalescing, save admission and no repeated effect.
The native rename journey also covers a real one-time file move with its reply
lost and subsequent proof unavailable, then unsuccessful and successful visible
Retry. The existing failed editor-readback journey remains covered separately.

The two outdated compaction assertions now expect the provider's existing
allowlisted quota/HTTP rejection messages. They continue to require terminal
failure without automatic retry and exclude private server text from retained
entries and tasks. No provider behavior was changed for these assertions.

The browser rerun caught an intermittent split-focus failure in a discovery
keyboard test that did not await its asynchronous Last edited rows. A named WDIO
session verified loaded-row focus, passed the original sequence 12 times, and
reproduced the missing-row behavior by delaying only that read. The maintained test now waits
for the edited mode, two rows and input focus before testing row navigation;
its existing split-focus and opening assertions remain. This changes no app
navigation behavior. The historical manual guide now points to the accepted
in-place recovery, Atlas-filter and unified-permission records.
Rust formatting also normalized two existing note-naming test cases.

Fresh verification:

- Focused publication/compaction checks: 56 passed. Full frontend: 1,664 passed,
  one skipped; support/harness: 143 passed.
- `pnpm check`: zero errors/warnings, including E2E TypeScript. Production build
  passed with the existing large-chunk advisory.
- Rust library: 714 passed, 22 ignored. Architecture fitness: 19 passed. Python
  tooling: 16 passed. Client-error browser checks: three passed.
- Native app: nine rename, seven draft recovery and five publication scenarios
  passed. The unrelated opt-in Temporary-grant process-reopen case was skipped.
  Synthetic model protocol, real Pi tasks/native owners/filesystem, disposable
  vaults and the worktree's pinned background debug app were used. No live-model
  quality, foreground OS focus, physical-device IME or animation claim is made.
- Final complete browser replay: all 23 specs passed, including the corrected
  keyboard journey. The first run had 22 passing specs and that one intermittent
  failure; the fresh complete replay passed in 3m53s.
- Rust formatting and `git diff --check` passed. Bounded independent follow-up
  review of the recovery correction found no remaining correctness/standards
  defects; local spec review found no unmet requirement in these two fixes.

Final app artifact: `src-tauri/target/e2e/debug/gneauxghts`, SHA-256
`00eae7d05a0a46ff9f46c8715caf99a17ee2744425cb98dbed118a9b8d9b28fa`.
The schema-15 explicit history-reset policy in ADR 0015 is unchanged; these
corrections add no schema change, reset or migration.

The named investigation browser session and owned test processes/servers were
closed; fixture ports 1423, 1430, 1447 and 4445 have no listeners. No commit, push
or merge was performed in this readiness correction.
