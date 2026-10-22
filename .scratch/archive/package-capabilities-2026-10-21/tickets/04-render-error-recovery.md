# Present client errors safely; gate stateful recovery separately

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task

This ticket's implementable scope is synchronous, privacy-safe client error
classification and a minimal route error page for the static Tauri SPA. It does
**not** promise that a failed rendering subtree remains mounted, that drafts were
saved, or that restarting/remounting is safe. Recovery controls and root-shell
failure containment are separately **needs-triage**, with the prerequisites below.

## Outcome

An unexpected client navigation/rendering failure displays a fixed explanation
and a short local diagnostic reference. Expected application/framework errors
retain their status and a curated explanation rather than being presented as an
application crash. There is no automatic retry, reload, navigation, relaunch, new
save queue, or Pi runtime intervention. A read-only, selectable diagnostic summary
is useful even when clipboard access is unavailable.

## Current behavior and evidence

- [`src/routes/+layout.ts`](../../../../src/routes/+layout.ts) disables SSR. There is
  no application server, custom `hooks.client.ts`, or `+error.svelte`.
- Installed Kit **3.1.0** uses a discriminated hook input `{ kind, error, event }`;
  expected `app`/`framework` errors now also reach `HandleClientError`. Unknown
  errors default to status 500 and a safe generic message. The hook must never
  throw; a synchronous implementation needs no experimental async compiler.
  See installed `node_modules/@sveltejs/kit/types/index.d.ts` (`ClientCaughtError`,
  `HandleClientError`) and `src/runtime/client/client.js::handle_error`.
- Kit's `initialize` passes a `transformError` to Svelte `mount`, which invokes
  that hook and updates `page.error`/`page.status`. Its
  `src/runtime/components/root.svelte` installs boundaries for child route nodes;
  `client.js::_start` deliberately leaves the **root layout boundary unarmed**.
  A root `+error.svelte` therefore does not catch failures in root layout script,
  the layout's own effects, or its `NavBar`. Do not edit generated `.svelte-kit`
  files, which may be stale, to implement this capability.
- A failed child boundary removes its previous children. The workspace is under
  `src/routes/+page.svelte` → `Notepad.svelte`; replacing that subtree runs its
  teardown. `Notepad.svelte` retains resources while `publicationOwner.close`
  settles effects, then invokes the session cleanup. That cleanup unregisters
  pending-save handlers and performs only a defensive asynchronous flush; it is
  not a pre-teardown save barrier.
- `navigation/pendingNoteSave.ts::awaitPendingNoteSave` succeeds immediately when
  no owner is registered. Consequently, the existing restart/navigation helpers
  cannot establish draft durability after the failed workspace has disappeared.
  Do not add a Restart, Go Home, Try Again, or boundary `reset` button by simply
  calling those helpers from the fallback.
- [`pi/diagnostics.ts`](../../../../src/lib/features/chat/pi/diagnostics.ts) already
  demonstrates bounded ephemeral curated diagnostics without raw exception
  strings. Its records remain Pi-specific; do not mix rendering diagnostics into
  its task/runtime state. `logDevError.ts` is development-only and is not a
  production diagnostic sink.

Primary API references: [Kit 3 error handling](https://svelte.dev/docs/kit/migrating-to-sveltekit-3#Error-handling),
[client hook](https://svelte.dev/docs/kit/hooks#handleError),
[Svelte boundaries](https://svelte.dev/docs/svelte/svelte-boundary).
Installed source above is authoritative for the pinned versions.

## Ordered implementation

1. Add a small pure client-error presentation module, proposed
   `src/lib/app/clientErrorPresentation.ts`. Return a fixed catalog code/message,
   bounded local reference, and validated status from an explicitly typed Kit
   hook input. Do not stringify arbitrary thrown values or access their arbitrary
   getters, prototypes, stacks, `cause`, request bodies, URLs, parameters or notes.
   Treat both known and unknown thrown values as untrusted. For known framework
   404 use a fixed “Page unavailable” presentation; use generic catalog text for
   other statuses rather than displaying arbitrary `error.message` supplied by
   application code. Do not infer that every unknown navigation error is a render
   error: use a generic client-failure category.
2. Add `src/hooks.client.ts` exporting synchronous `handleError` using the installed
   `HandleClientError` type. Preserve `kind`, validated status semantics and
   expected-error distinction. Return only curated fields; use optional
   `App.Error` extensions in a new application ambient declaration (for example
   `src/app.d.ts`) for `diagnosticId` and a finite presentation code. Keep a final
   fixed fallback if reference creation/classification fails. No hook dependency
   may initialize AppStore, Pi, editors, native transport or persistence.
3. Add `src/routes/+error.svelte`, using `$app/state` and installed Kit error props
   as appropriate, displaying the catalog message, status and selectable reference
   with a semantic heading. For unexpected failure include explicit, short copy:
   “The workspace could not be displayed. Recent changes may not have been saved.”
   Do not say that edits were lost, safely retained, or saved; actual owners decide.
   Keep this page plain HTML/CSS with no Bits/CodeMirror/chat dependencies. Avoid
   automatically restoring focus to a destroyed editor. Keep expected 404 copy
   distinct. No recovery/navigation buttons in this stage.
4. If retaining a diagnostic record, keep it **bounded and in memory only**, with
   allowed fields limited to the generated reference, finite category/status and
   optionally app version. A reference is correlation, not a promise of an on-disk
   log, stack trace, telemetry report or recoverable draft. Do not introduce a
   diagnostics database or global `error`/`unhandledrejection` interception here.
   Prefer a selectable summary over adding clipboard permissions. Repeated
   fallback rendering must reuse the existing reference rather than generating
   more records.
5. Add focused classifier/hook tests and a rendering fixture that exercises the
   fallback. Include hostile thrown values, unexpected errors, app/framework
   statuses, hook non-throwing behavior and secret sentinels. The fallback must
   render when no diagnostic reference is available. Update the capability report
   to distinguish this safe presentation from deferred recovery.

## Deferred recovery and shell containment — needs-triage

**Exact prerequisites:** decide and implement how a still-live workspace owner
retains and exposes dirty document bodies, composer drafts, pending restores and
publication leases across a rendering subtree failure. Prove that owner settlement
can be joined even after mounted save handlers disappear. Decide separately how
app-shell navigation is admitted during fatal failure; `NavBar` currently remains
outside the child route boundary, so omitting a fallback navigation button does
not disable existing header/history/navigation paths. Do not claim this first
stage closes those existing platform departure gaps.

Only after those contracts are explicit may a follow-up choose narrower
presentation-only boundaries, recovery/remount, or a save-then-restart control.
Putting `Notepad` inside a new broad boundary does not retain its owners. Putting
root layout markup inside a boundary retains the layout script owner but still
cannot catch its own initialization failures; wrapping/remounting the whole shell
can retire background persistence and restart listeners. A full owner lift is an
architecture change and needs revised behavior invariants and, if it changes the
Pi seam, ADR 0012 review. Do not create parallel state stores or duplicate Harnesses
to claim recovery. A UI failure alone must not abort, close, retry or recreate Pi
tasks; observer disposal and existing publication settlement keep their current
meaning.

## Files, parallelism and dependencies

- Owns new `src/hooks.client.ts`, `src/app.d.ts`, the presentation module/tests and
  `src/routes/+error.svelte`. It can proceed independently of connection errors,
  benchmarks, image delivery and search excerpts.
- Inspector ticket 03 touches `vite.config.js`/developer scripts. This stage does
  not need that file or async Svelte compilation. Coordinate a shared report edit
  with the plan owner rather than racing another ticket.
- Root layout, `NavBar`, document/session lifetime and `restartLifecycle` changes
  are deliberately excluded until the recovery prerequisites are resolved. Do not
  opportunistically change their ownership during this ticket.

## Verification and acceptance

1. Type checks/build prove the synchronous hook compiles under current static SPA
   configuration. Focused tests establish curated output, finite status handling,
   expected-error distinction and non-throwing behavior even for hostile values.
2. A component fixture throws during initial child render and a subsequent update;
   assert a single fallback with safe copy/reference and no automatic retry loop.
   Cover a failing fallback dependency by keeping its production dependencies
   minimal; do not claim boundaries catch event handlers, arbitrary async tasks,
   module import/startup errors or root-layout failures.
3. Follow `docs/agents/ui-verification.md` for browser session/evidence/replay and
   `e2e/README.md` for native acceptance. Inject a real child-render fault in an
   isolated fixture/source overlay or temporary validation change, then remove it;
   do not ship a production query flag, IPC command, global test function or hidden
   failure route. Prefer an isolated Kit integration fixture for a maintained
   regression. A synthetic `window.dispatchEvent(new ErrorEvent(...))` does not
   establish that Kit rendering boundaries work.
4. In browser and native WebKit, verify readable fallback at narrow/wide sizes,
   keyboard access to selectable diagnostic text, and expected 404 separately.
   For an injected workspace failure, start with a dirty note and unsent composer
   text in a disposable vault. Inspect the existing owners/cleanup and any saved
   bytes without claiming state retention; confirm no new save/rename/publication,
   automatic reload, restart, Pi Harness creation or task replay originates from
   error presentation. Observe active Pi work through its existing/native owner,
   rather than treating a destroyed view as proof the task stopped.
5. Use unique secret/note/path sentinels in the thrown error and confirm none occur
   in rendered diagnostics, copied/selectable summary, retained records or hook
   logging. This ticket does not sanitize unrelated existing application logs.
   Record which faults tear down the workspace and which root-shell faults remain
   outside scope; do not report general unsaved-state recovery as accepted.

## Comments

Planned 2026-10-21 against the upgraded frontend capability research and current
architecture/behavior invariants. Planning only; no app changes or runtime
verification performed. Any future recovery work must re-read current owners,
since their teardown/admission contracts may change independently.

Implementation 2026-10-21 (safe presentation scope): added a synchronous Kit 3
client hook, a state-free curated presentation catalog, optional typed error
fields, and a plain route error page. Expected application/framework statuses
400–599 are retained; 404 has distinct fixed copy, other expected failures use
generic request copy, and unexpected failures use status 500 plus the explicit
unsaved-changes caveat. Unknown exceptions are never inspected. Expected status
access uses only own data descriptors, with a nonthrowing fallback for hostile
proxies. Raw messages, URLs, stack/cause, and navigation events are not read or
logged. No diagnostic records are retained. The hook creates a bounded ephemeral
reference when crypto is available; rendering reuses it or shows “Unavailable”.
The selectable summary contains only status and the validated reference.

No layout, navigation, restart, persistence, workspace owner, publication or Pi
runtime changes were made. The known failed-child teardown and root-shell
coverage limits above remain. This implementation establishes error presentation,
not unsaved-state recovery.

Focused validation: `pnpm exec vitest run
src/lib/app/clientErrorPresentation.test.ts
src/lib/app/clientErrorPage.svelte.test.ts` passed 10 tests across 2 files.
They cover hostile values/accessors/proxies, finite statuses, reference failure
and reuse, synchronous hook behavior, secret sentinels, expected 404 rendering,
and a fallback without a reference or recovery controls.

A maintained, separate Kit application under
`scripts/fixtures/client-errors/` imports the production hook/error component and
throws real initial and update child-render failures plus an expected application
404. It writes generated output only beneath ignored evidence and does not add
failure routes, flags, globals or IPC commands to the shipped application.
Its README records the WDIO session/replay commands. Fresh regression command
`pnpm exec wdio run scripts/fixtures/client-errors/wdio.conf.js` passed all
3 cases in Chrome 155. It verifies real initial/update child rendering failures,
one fallback, fixed safe copy with no secret sentinel, keyboard access to the
read-only summary, unchanged reference across repeat reads, and no recovery
controls. The narrow case uses WDIO 10 `setViewport` and asserts actual
`window.innerWidth === 390`; window resizing alone has a 500px Chrome minimum.
Selected initial-wide/update-narrow/expected-404 screenshots were visually
inspected under ignored `.scratch/package-capabilities/evidence/client-errors/`.
The owned loopback server and browser were closed. Combined type/build checks
and native WebKit/workspace acceptance remain integration responsibilities;
do not mark those accepted from the isolated fixture or focused tests.

Prepared (not executed) native workspace acceptance under ignored
`evidence/client-errors/native-workspace-fault-overlay.mjs`. It uses an exclusive
temporary source overlay with an exact-byte backup and `finally` restoration,
the existing pinned native binary/owned harness, disposable saved note and
ordinary split Pi pane. It stages unsent composer text and a dirty CodeMirror
edit, then triggers a real child failure and observes the original Pi run through
an existing retained watch. No production trigger is retained. The script never
enables foreground presentation; root must schedule its native window after
other chats' native/build/timing work. Only script syntax has been checked; no
native process, server, build, fault injection or source edit has run for this
prepared scenario.

The prepared native config additionally owns the isolated Kit fixture on port
1447 and defines WebKit checks for actual initial/update child rendering failures
and expected application 404. It requests and asserts measured 1200px/417px CSS
viewport widths, checks readable safe copy and a stable read-only summary, and
returns to the ordinary native workspace in `finally` before its background
focus/IPC hook. No remote-origin permission is added. These checks have only
been prepared; execution is still reserved for the root-owned native window.
