# Pi provider and observation adapter alignment

Recorded 2026-10-16. **All six tickets implemented and tested.** These records are
historical, outside the executable backlog. The [agreed scope](spec.md),
[version-matched audit](research.md), [tickets](issues/06-regression-acceptance.md)
and [selected sanitized evidence](evidence.json) retain the decision and results.

Fresh-context agents implemented 01/03/04 in parallel, followed by 02/05 after
their dependencies; the same-worktree orchestrator integrated and accepted 06.
Independent Standards and Spec reviews found no remaining actionable issue. The
comparison baseline was this effort's initial dirty-worktree snapshot, not main;
the earlier ordinary-chat rebuild was preserved.

## Implemented outcome

- Public Pi AI `createProvider` replaces hand-assembled providers and the separate
  catalog map. Standard and simple streams delegate to their distinct upstream
  implementations. Native discovery is deduplicated within startup while every
  valid native binding is restored before any scheduling operation.
- Native-selected reasoning uses Pi's public compatibility/options mapping.
  Rust retains final normalization for current settings and untrusted serialized
  requests, endpoint/credential resolution and tool-capability validation.
  Hosted service tier stays native because Pi 1.3.0 `streamSimple` omits that option.
- Pi reports, actual Harness termination and observation failures feed a bounded
  ephemeral curated diagnostic sink. Unknown errors use fixed messages; hostile
  getters, causes, payloads and raw exception strings are not diagnostic content.
  Reports do not fail generation or change retry, authority or settlement. Actual
  terminal runtime failure disables work controls while retaining readable history
  and editable drafts. Shutdown clears presentation.
- Chord cancellation replaces manual selected-watch bookkeeping. Selection reads,
  watches and history pages use disposable observation contexts; Stop, queued-input
  withdrawal, submissions and native retirement retain their distinct operations.
- List summaries read `ChatDoc` and `AgentDoc` rather than resolving full agents.
  Public commits update loaded metadata. Serialized reads replay intervening changes,
  retain older pages and handle newly attached documents; live/usage commits do not
  rehydrate unchanged rows. No durable list mirror or new execution owner is added.

The first independent Spec review found raw observation-acquisition exceptions
could reach presentation. The correction routes them through the safe sink and
fixed fallback, with canary/getter and single-report regressions. Ordinary native
action errors retain their pre-existing domain presentation path.

The resolved-model capacity adapter remains deliberate: Pi 1.3.0's static factory
retains model references; dynamic refresh replaces records. Updating an existing
resolved record after successful native discovery keeps first-inference observed
capacity visible before the next standard compaction decision. Unknown limits stay
unknown, and explicit configuration refresh invalidates that observation. Forcing
provider-wide `fetchModels` would require additional identity/publication machinery.

This is an ownership/API alignment with new diagnostics and list consistency
logic, **not a claim that total source size decreased**. Manual watch cleanup and
generic provider/catalog plumbing were removed; safe reporting and tested list-race
handling add code. Native dispatch/terminal citation checks (including compaction),
scoped permissions, exact publication intent/receipt/NoteTimeline proof, canonical
editor adoption and joined shutdown remain application guarantees. Current owners
are described in [architecture](../../../ARCHITECTURE.md#agent-runtime),
[behavior invariants](../../../docs/architecture/behavior-invariants.md#chat) and
[ADR 0012](../../../docs/adr/0012-found-ordinary-chat-on-pi.md).

## Matched measurements

| Fixture observation | Before | After |
| --- | ---: | ---: |
| Startup model discovery, five valid bindings / three distinct pairs | 5 | 3 |
| Valid bindings restored before scheduling | 5 | 5 |
| Initial 50-row list: conversation handles/full-agent resolution | 50 | 0 |
| Initial list: scan / ChatDoc snapshots / AgentDoc snapshots | 1 / 50 / 50 | 1 / 50 / 50 |
| Loaded-row rename: scan / handles / ChatDoc / AgentDoc | 1 / 50 / 50 / 50 | 0 / 0 / 0 / 0 |

Startup comparison was rerun against the saved pre-effort runtime with the same
seeded fixture. The 60-conversation list fixture was measured before/after by its
owner. These counts are observations, not persistent budgets. No matched total
storage, latency, memory or battery claim is made.

## Accepted validation

Pi Durable, Pi AI and Chord remain pinned at **1.3.0**, with public exports only.
Host tooling: Node 24.2.0, pnpm 12.9.1, Cargo 1.95.0, Xcode 27.0 / simulator SDK 27.0.

| Check | Result |
| --- | --- |
| `pnpm check` | Zero errors/warnings; includes E2E TypeScript |
| `pnpm test` | 1,159 tests / 145 files, plus 32 support tests |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 709 passed, zero failed, 19 pre-existing ignored |
| `node --test scripts/pi-chat/ios-acceptance.test.mjs` | 8 passed |
| Ordinary `pnpm build` | Passed; no test token or simulator/canary markers in output |
| Rebuilt native E2E ordinary-chat fixture | 10 passed, including different-process reopen |
| Task-only native publication fixture | 6 passed |
| Standard compaction fixture | 2 passed, including Stop of held background compaction |
| Native adapter diagnostics fixture | 2 passed |
| Actual configured local Qwen chat/read/citation | 2 passed |
| Signed simulator adapter scenarios + process reopen | Passed |

Desktop commands used `node e2e/support/buildNative.mjs`, then sequential
`pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/<spec>.spec.ts`:
`piChatNative` with `GNEAUX_PI_FIXTURE_ACCEPTANCE=1`, `piChatPublication` with
`GNEAUX_PI_PUBLICATION_ACCEPTANCE=1`, `piChatCompaction` with
`GNEAUX_PI_COMPACTION_FIXTURE=1`, `piChatAdapters` with
`GNEAUX_PI_ADAPTER_ACCEPTANCE=1`, and `piChatLocal` with
`GNEAUX_PI_LOCAL_ACCEPTANCE=1`. `GNEAUX_PI_PROCESS_RESTART=1` enabled actual restart
checks. All used disposable generated vaults, background presentation and an owned
temporary acceptance-output directory. No original-vault access or foreground
opt-in was used. The first sandboxed support run could not bind loopback; the
authorized host run passed. Restart-related WebDriver warnings did not fail gates.

Full native/shared suites cover restrictions at dispatch, streaming and terminal
admission, compaction retirement, storage rollback/lease revocation/shutdown joining,
exact approval, dirty/conflicted targets, lost-ack reconciliation, committed warnings,
native page generations and canonical editor adoption. Protocol fixtures exercise
hosted Responses parsing/options/errors without live hosted credentials.

The bounded simulator build used `tauri/custom-protocol`, ordinary `/`, a test-only
authenticated loopback controller and generated-vault guard. The signed isolated
acceptance bundle ran on iOS 26.4, arm64 simulator. Actual observations establish live
text/reasoning before terminal completion, collapsed/expanded reasoning, report
coalescing and safe canaries during generation, switching between two independent
runs, Stop, native read/citation and different-process reopen. Reopen retains
identical transcript hashes and sources, clears ephemeral diagnostics and dispatches
no inference. Selected evidence contains only codes, counts, booleans and labels.

Two simulator harness mistakes were corrected: an initial check inspected persisted
entries rather than live output; a later reopen setup omitted opening the chat pane
and hit its finite deadline. A fresh launch and corrected probe passed all final
assertions. These were test-driver failures, not product defect claims.

## Limits and cleanup

Native/simulator terminal notification is explicitly synthetic **presentation**
evidence. Actual failed Harness/storage behavior is tested separately in
`runtimeDiagnostics.test.ts`; it is not claimed to be a native storage-corruption
injection. Simulator scenarios use controlled provider fixtures and programmatic DOM
actions, not live-model, touch/keyboard or physical-device acceptance. Desktop live
local chat passed. Live hosted credentials, physical-device suspension/signing,
memory/battery and normalized performance remain outside the agreed gate.

No Pi upgrade, fork, private imports, scheduler, custom compaction, mutation product
tool/UI, draft-storage migration or durable diagnostic/transcript/list mirror was
introduced. No original vault, user credential or local-model setting was modified.
The pre-existing Fresh Chat desktop app was preserved. All owned desktop E2E apps,
the simulator acceptance app/device and authenticated controller/provider listeners
were closed after testing. The final ordinary build excludes acceptance controls.
