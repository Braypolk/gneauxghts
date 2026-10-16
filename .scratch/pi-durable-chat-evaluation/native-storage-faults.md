# Prepared native storage fault phase

`src/lib/prototypes/pi/nativeStorageFaultProbe.ts` exports:

```ts
await runNativeStorageFaultProbe({
  phase: 'last-after-ui',
  generatedSyntheticRoot: true
});
```

The native lease owner executes this only inside a fresh generated synthetic
fixture app, after every chat/editor/UI journey and its receipts have finished.
The function checks native `fixture` and `interactiveGate` flags, closes chat
owners, and then opens the existing native SQLite facade. Opening that singleton
revokes earlier handles. Persist the returned report separately from earlier UI
reports and terminate the app; later chat work requires a process relaunch.
There is no ordinary-app or copied-vault activation path.

Prepared checks use native SQLite semantics, without upstream runtime hooks:

| Check | Required observation |
| --- | --- |
| Callback rollback | Exact callback error retained; inserted row absent |
| COMMIT failure | Deferred foreign-key callback returns; real COMMIT rejects; row absent; later valid transaction commits |
| SQLITE_FULL | Bounded page quota rejects a blob insert; late COMMIT cannot acknowledge; explicit owner reopen has zero rejected rows and permits a small valid write |
| Lease expiry | Wait for actual native 10-second deadline plus watchdog poll; owner revoked; explicit reopen verifies rollback and rejects the expired owner |
| Disconnect/stale owner | New owner revokes old owner and rolls back its transaction; stale COMMIT rejects; fresh owner can commit |

The storage-full check accounts for reusable free pages, requires its attempted
blob to remain at most 16 MiB, restores the original page quota and removes its
own test table. It records any explicit rollback error separately: SQLITE_FULL can cause
SQLite to roll back automatically. It proves explicit owner recovery, not a
seamless retry by the same owner. The quota produces a real SQLite FULL condition
without exhausting the host filesystem. The probe inserts only its own test
tables, never generic chat state.

Preparation is not native evidence. A throw means no pass; callers must retain
the failed boundary/error in their outer receipt. No Pi task staged-outcome or
terminal-persistence interruption is established by these facade observations.
Existing `fault-gate.mjs` covers native publication after-intent, after-publication
and after-receipt, plus in-flight model termination. The remaining Pi boundaries
need native command/transport observations and explicit relaunch/Retry evidence;
upstream hooks are not authorization or accepted persistence boundaries.
