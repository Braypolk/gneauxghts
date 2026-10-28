# Automatic watcher recovery — October 28, 2026

## Accepted outcome

Completed the user's selected watcher-recovery work. Failed OS registration no
longer prevents debounce and reconciliation workers from starting. The existing
reconciliation worker owns registration and its single OS watcher, scans
immediately after failed startup and every 15 seconds thereafter, and retries
registration after 15, 30, 60, 120, 240 and then 300 seconds between attempts.
Scan duration and filesystem accessibility can delay progress. Successful
registration clears startup diagnostics, scans to catch up and restores the
ordinary adaptive cadence. Healthy startup retains its lightweight prewarm.

Callback warnings remain retained until process restart, including warnings
received during registration. Settings distinguishes available fallback scans
from worker-start failure and explains automatic retry. Scans and registration
use the immutable Running Vault; staging a next-launch selection cannot redirect
them. Stop interrupts waits, joins in-flight work and drops the watcher before
Note Timeline clean close. Dropping an uninstalled handle also joins its workers.

Scans already entered Note Timeline and refreshed backend projections, but did
not notify open editors. Changed paths now publish the existing external-change
event after catalog projection succeeds and queue semantic updates/deletions.
Pending notifications survive failed projection commits; later scans refresh
their present/missing state. Unchanged scans emit no note events. Existing clean
adoption and dirty-conflict ownership continues to protect unfinished edits.

Native acceptance exposed two existing defects, corrected through their owners:

- During a rename scan, a canonical observation relocated the Note Identity,
  then the absent former path resolved through stale catalog data and marked
  that identity missing. Note Timeline now checks its retained current location
  before admitting Missing. A production reconciliation regression reproduced
  the failure before correction and verifies edit/rename/delete/recovery without
  splitting history or marking the renamed note missing.
- Notepad startup subscribed after pending navigation and two focus frames.
  A real scan could notify AppStore after the initial disk read but before that
  subscription, leaving the clean editor stale indefinitely. The mounted
  notepad now subscribes before the initial read; its existing refresh owner
  coalesces changes during the read. A controlled lifecycle regression covers
  admission during that read and delayed focus, plus release during startup.
  The native journey failed on the original ordering and passed three
  consecutive disposable-vault runs after correction.

Current ownership and guarantees are recorded in ARCHITECTURE.md and
docs/architecture/behavior-invariants.md. This outcome supersedes the deferred
recovery statements in the historical watcher-health outcome; the prior
status-only scope remains historical.

## Validation

- Full Rust library suite: **733 passed, 22 ignored**. An earlier broad run
  failed the unrelated atlas long-filename enclosure test; its isolated rerun
  and the subsequent full suite passed. Opt-in/release measurements were not run.
- `pnpm test`: **145 support checks and 1,852 frontend tests passed**, one
  existing opt-in frontend benchmark skipped.
- `pnpm check`: zero errors/warnings, including native E2E TypeScript.
  `pnpm build`: passed, with the existing large-chunk advisory.
- Watcher Rust coverage includes bounded backoff with scans between attempts,
  one retained watcher, stop during registration, stopped admission, callback
  retention and the production reconciliation/history journey.
- Signed, pinned macOS native artifact:
  `fd1af6baec4066ca8d2f207a504a674e65610a9d4c6c4ca2a189770141afff9c`.
  `watcher-health.spec.ts` passed ordinary OS detection and staged-vault health
  isolation. `watcher-recovery.spec.ts` passed three consecutive final runs:
  injected startup failure, periodic edit/rename/delete capture, task/history
  projections, clean editor refresh, preserved dirty conflict, staged-vault
  isolation, resumed actual OS notifications and `prepare_restart` joining.
  `app-lifecycle.spec.ts` passed all three existing cases, including expected
  background focus denial. Recovery joins the native smoke lane.
- Interactive WDIO session `watcher-recovery` exported the maintained
  `e2e/agent/specs/watcher-recovery.e2e.js`. Phone-width light/dark warning
  presentation was inspected, including its fit at 390×844. Fresh replay of
  watcher-health and watcher-recovery passed all three browser cases. Browser
  IPC fixtures do not prove native filesystem behavior.
- `git diff --check` passed. Named browser/session servers and disposable native
  processes were stopped; ports 1427 and 1430 were clear after final replay.

The E2E-only failure marker and accelerated one-to-four-second schedule are
scoped to an owned disposable vault and omitted from ordinary builds. No actual
OS resource exhaustion, system limits or user-vault mutations were used. Linux
watch-limit behavior and physical iOS suspension/notification behavior remain
unverified. Worker availability does not promise that every scan succeeds.

Native rename/deletion probes log missing-path refresh/recent-note errors while
the old location disappears; the assertions cover retained identity/history and
subsequent editing. Browser fixtures retain their documented unsupported
`pi_chat_bind_editor_owner` log. These are not warning-free whole-app runs.
Initial sandbox support/native attempts could not bind loopback servers; the
corresponding runs passed with loopback execution permissions.
