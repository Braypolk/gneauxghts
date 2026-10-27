# Watcher health in Vault Settings — October 27, 2026

## Agreed scope and outcome

The user selected status and guidance only, beside the vault location in
Settings → Vault, with callback warnings retained until process restart.
Startup and callback errors now have visible, distinct explanations. No manual
retry, registration-failure fallback scanning or OS-limit changes are included.

`AppState.watcher_health` retains one bounded, process-lifetime snapshot:
starting, watching, degraded, unavailable or stopped; a curated reason
(watch limit, permission denied or other); whether periodic reconciliation
started; and a monotonic revision. There are no raw paths, provider text or
exception messages in that contract. Duplicate or less-specific errors do not
produce new health events; watch-capacity exhaustion cannot be hidden by a later
generic error. Errors during registration are visible before startup completes.

`vault_watcher.rs` reports directory/creation/registration failures and callback
errors. Worker/startup-thread failures are also reported. Registration failure
still starts no reconciliation worker. Callback degradation after successful
startup retains the running worker and ordinary event filtering/queueing.
Neither file events nor successful scans clear diagnostic warnings.

The existing AppLifecycle and watcher stop/join path retire health before
teardown, including when background registration has not installed a handle.
Late startup or callback work cannot revive stopped health. No second service
lifecycle, watcher, persistence store or Settings polling loop was introduced.

Bootstrap and Settings bundles include the retained snapshot. AppStore owns its
admission and the `watcher-health-changed` listener; native revisions reject
older bundles/events independently of unrelated vault changes. Listeners now
attach before the bootstrap request to close the early-failure delivery gap.
Listener failure cleans partial subscriptions, and disposal while attachment is
pending prevents a stale bootstrap command. Settings reads the shared projection.
Staging another Next-launch Vault Selection does not redirect these diagnostics.

The display is searchable as “External file changes,” announces updates politely,
and uses the selected app theme. Phone-width light/dark warnings were visually
inspected. Architecture and behavior invariants record the current owners and
contract; the original issue is a resolved pointer to this outcome.

## Validation

- `pnpm test`: 143 support checks and 1,708 frontend tests passed; one existing
  opt-in benchmark skipped. Focused AppStore/Settings/presentation coverage is
  included, with delayed bootstrap, queued events, stale Settings responses,
  listener failure, disposal and both warning presentations.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib watcher`: 24 passed,
  including injected watch-limit, permission and generic errors; bounded updates;
  callbacks before startup completion; actual callback queueing after errors;
  safe serialization; self-save/history/reconciliation regressions; and retirement.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib app::lifecycle::tests`:
  seven passed, including an actual lifecycle close before watcher installation
  followed by rejected late diagnostic work.
- `GNEAUXGHTS_AGENT_PORT=1427 pnpm agent:test --spec ./specs/watcher-health.e2e.js`:
  two passed on a fresh fixture, after interactive session export/review. Covers
  callback warning persistence across route navigation, stale events, startup
  permission guidance, truthful scan status, no recovery buttons, and 390px layout.
- `pnpm test:e2e:browser --spec e2e/specs/browser/startup-readiness.spec.ts --spec
  e2e/specs/browser/settings.spec.ts`: 21 existing regressions passed.
- `pnpm check`: zero errors/warnings, including the native test's TypeScript.
- `pnpm build`: production frontend build passed.
- Signed/pinned native E2E build and `watcher-health.spec.ts` passed in background
  macOS WebKit. An actual filesystem edit, without the deterministic watcher-flush
  helper, reached the production AppStore event consumer and updated the task
  projection. Vault Settings showed watching; staging another vault preserved
  the Running Vault's exact health snapshot. The spec joins the smoke suite.
- `node e2e/support/restartLifecycle.mjs`: disposable native clean-close,
  repeated ready receipt, post-close mutation rejection, process relaunch,
  retained Editing Window history and continued editing/second close passed.

## Evidence and limits

Interactive session: `e2e/agent/.wdio/session/watcher-health/`; selected final
phone captures: `e2e/agent/.wdio/watcher-health/phone-light.png` and
`phone-dark.png`. These generated artifacts are ignored. The maintained browser
and native regressions are the reproducible records. Session/server and native
fixture processes were cleaned up after validation.

Final pinned native executable SHA-256:
`97e4712b0e6409ad5a5aabe4c93828dbd7fedf177c4ee1316d0e908c2401d1d8`.
The final restart runner retained its events and result in
`/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-restart-lifecycle-tpygug/`.

Browser navigation logs include the existing unsupported
`pi_chat_bind_editor_owner` fixture command; publication is outside this browser
check. Expected history-failure probes also log their intended failures. These
are not warning-free whole-application acceptance runs.

Initial sandbox runs could not bind loopback fixture servers or access the
configured signing identity; the same checks passed with the corresponding
execution permissions. No actual OS watch exhaustion or system setting changes
were used. Linux watch-limit classification is simulated portably, not validated
on Linux. Physical iPhone notification/suspension behavior is unverified. Periodic
scan availability means its worker started, not that every scan succeeds or OS
watching has recovered. Retry and fallback scanning remain separate decisions.
