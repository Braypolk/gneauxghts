# Restore unfinished work to the original note

Completed 2026-10-22 in worktree `93d8/Gneauxghts` at the user's request.
Supersedes the [historical separate-copy policy](../draft-recovery-verification-2026-10-22/README.md).
Current ownership and policy live in [ADR 0014](../../../docs/adr/0014-retain-unfinished-work-as-private-recovery-copies.md).

## Result

Recover work opens the original Note Identity using ordinary workspace navigation,
which rereads canonical content, then restores unfinished title/body/tags through
the document editing owner. Body recovery updates the same file; recovered title
edits use ordinary rename behavior while retaining identity. No duplicate is made.
Never-saved ideas resume as drafts and publish one note through ordinary saving.

Private backups now optionally retain saved base content. When current canonical
content differs, or an older backup has no base, the existing conflict UI requires
Keep my edits or Load disk version before saving. Unresolved conflicts remain
uncertain in subsequent backups, so another interruption cannot accept them.
Missing originals retain their backup and show a retryable failure without creating
a replacement. New unsaved editor work and unresolved conflicts are protected.
Matching already-saved content is acknowledged without replaying a save.

Restored work is backed up before the old backup is retired. Canonical adoption
and explicitly loading the disk version retire clean backups. Backup failures remain
visible and retryable without weakening mandatory history preparation. Private
coalescing still leaves a loss window and shares the vault's storage.

## Verification

- 61 focused frontend tests passed across recovery capture, document editing,
  conflict coordination and tag conflicts.
- Three Rust storage tests passed, including optional saved-base round trips and
  reading legacy backups, tombstone ordering and reopen/vault isolation.
- Three browser cases passed: failure/Retry and recovery into the original identity,
  uncommitted title capture/recovery and narrow-viewport reachability.
- Seven native cases passed: actual SIGKILL/relaunch with live unfinished title
  capture, normal-save cleanup, same-file body recovery, both conflict choices,
  another interruption during an unresolved conflict, one never-saved idea and
  missing-original retention. The keep-edits case includes the second interruption.
- `pnpm check` passed with zero errors/warnings, including E2E TypeScript checks.
- `git diff --check` and targeted Rust formatting checks passed.

The named WDIO session `recovery-original-2210` verified saved content, unchanged
note count and no created identity through the UI and fixture IPC. Its inspected
[screenshot](browser-recovered-original.png) shows the original Alpha note after
recovery. The first click targeted the collapsed disclosure's hidden action;
expanding the disclosure fixed that session step. Fresh replay passed.

The first native run exposed a real cleanup gap: loading disk content resolved the
conflict without a canonical save, leaving the backup behind. The Notepad
composition now reconciles recovery after explicit external adoption. The unchanged
native regression then passed with all seven cases.

[Crash/relaunch result](native-recovery-result.json) and [body recovery result](native-same-title-result.json)
record unchanged identities/counts and no duplicate files. Native artifact:
`src-tauri/target/e2e/debug/gneauxghts`, freshly built here with `e2e-wdio`, SHA-256
`66d4be71ee86b53ce3b1880e94f0c87ab58f25378f8a657044bc6b97fe76f618`.
The debug frontend was served from this checkout. A subsequent formatting-only
change affects a Rust test, not the runtime. Native testing used disposable vaults
and background WebKit; it does not establish foreground OS typing/paint or physical
iOS behavior. Crash-related driver/session-close warnings are expected. Browser
fixtures do not implement Pi publication owner binding; those console messages do
not establish Pi behavior. Conflict refresh logs unsaved background work as expected.

The full test/smoke suites were not rerun. Named browser session, fixture servers,
owned native processes and ports 1423/1430/4445 were cleaned up.
