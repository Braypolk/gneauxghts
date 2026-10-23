# Draft recovery verification

Historical separate-copy policy. The subsequent [in-place recovery change](../draft-recovery-in-place-2026-10-22/README.md)
supersedes this behavior and updates the maintained regression cases.

Completed 2026-10-22 in worktree `93d8/Gneauxghts` at the user's request.
No application behavior was changed. Added three native regression cases to
`e2e/specs/native/draft-recovery.spec.ts` and registered them in the smoke lane.

## Observations

- An unfinished title is backed up before blur. Force-killing only the exact
  admitted disposable native process, then relaunching it against the same data,
  shows Recoverable work with the unfinished title. The original opens unchanged.
- Resume copy creates exactly one new file and Note Identity. Original raw file
  bytes remain identical before/after recovery and after a subsequent reload.
- Resuming an unfinished body with the original title uses ordinary collision
  naming: `Recovery same title.md` stays unchanged and the recovered content goes
  into `Recovery same title 2.md`, with a different Note Identity. This case seeds
  a persisted interruption through real native backup IPC; live capture/crash is
  separately established by the title case.
- Successfully saving a title change removes its backup. Neither normal save nor
  a saved resumed copy is offered again after reload; another reload creates no
  additional files.
- The copy can look like a duplicate, especially when only its title changed.
  That follows ADR 0014's separate-copy behavior rather than replacing the source.

## Validation and evidence

Three native cases and the existing three browser recovery cases passed. Browser
coverage includes backup failure/Retry, source preservation, uncommitted title
capture and the narrow viewport. The named WDIO session `recovery-final-2045`
was also inspected interactively; its [screenshot](browser-recovery-offer.png)
shows where the disclosure appears. [Native crash result](native-recovery-result.json)
and [same-title result](native-same-title-result.json) retain the identities and
file assertions; disposable vaults were removed after testing.

Native artifact: `src-tauri/target/e2e/debug/gneauxghts`, freshly rebuilt from this
worktree with `e2e-wdio`, SHA-256
`7c8aa838e99b8b793ad8e10142ca9578775ec600c43b82bb9686c62fbc7319c4`.
The debug frontend was served from this same checkout. Background WebKit testing
does not claim foreground OS typing or physical paint; browser layout evidence
was inspected separately. The first native attempt exposed a test-path error
(`/var` versus canonical `/private/var`), corrected before passing runs. Driver
session-close warnings after the deliberate kill are expected.

`pnpm check:e2e` and `git diff --check` passed. The full smoke lane was not rerun.
The named browser session, fixture servers and owned native processes were closed.
