# 06 — Use one bootstrap protocol and one admitted vault snapshot

Status: resolved
Depends on: 04, 05; fresh triage required
Scope: authorized after accepted Tickets 04–05; bootstrap and shared-snapshot cleanup only.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

AppStore and Settings retain separate VaultInfo/semantic snapshots; Settings remembers `activeVaultPath` from its first load (`src/lib/features/settings/store.svelte.ts:148`). Bundled bootstrap failure fans out to legacy session/vault RPCs and can admit an empty session (`notepadSessionLifecycle.ts:63`, `:74`, `:118`). AppStore caches rejection, while listener errors are swallowed (`src/lib/app/appStore.svelte.ts:62`, `:179`). Remount reads selected root again (`notepadSessionLifecycle.ts:107`).

## Implementation instructions

1. AppStore owns admitted backend running/next-selection and semantic snapshots. Settings retains draft input and local request/error state, subscribes to the shared snapshots, and sends command results through the same admission path. Keep Settings-only semantic settings/debug and history diagnostics where they have a separate scope. Guard every event, command result and bundled Settings load with a coherent snapshot revision/operation-admission rule; current bootstrap-only revision checking is insufficient. A late Apply B result or older Settings snapshot cannot overwrite a newer Apply/event C or semantic event.
2. Delete first-load `activeVaultPath`, duplicate assignment/event/visibility refresh paths for shared snapshots, and redundant retention reload on next-launch selection.
3. Bundled bootstrap is the sole initial-session retrieval protocol. Remove `loadSavedNoteFallback`, `loadAssetRootFallback`, and their exclusively used helpers in `src/lib/features/notepad/session/session.ts:110`. Remove remount `get_vault_info` bypass. Make Settings bundled-load failure explicit rather than silently fan out to older equivalent RPCs.
4. Make bootstrap rejection retryable at AppStore. Required listener registration participates in admission; partial listeners are cleaned before retry. Preserve event/snapshot revision ordering so newer events win over delayed bootstrap data.
5. Keep backend readiness distinct from mounted-session adoption (`runtimeStore.svelte.ts:15`). Keep stale-mount guards. Use the bound running root for editor assets. Failed required bootstrap must not appear as an empty editable vault.
6. Remove Notepad's unmount fire-and-forget workspace flush (`Notepad.svelte:1461`) only after all actual navigation/restart departure routes are proven to cross the explicit barrier. Retain a necessary defensive path if a real ungated route survives; record it rather than hide that limitation.

## Acceptance and validation

- Test failed bootstrap then successful retry, partial listener failure, newer event before snapshot, remount after Apply B while running A, Settings refresh, delayed Apply B after C, delayed Settings load after newer semantic/vault events, and an unresolved document conflict blocking departure.
- No fallback protocol remains for equivalent initial data; narrow independent APIs may remain for unrelated real callers.
- Do not merge workspace ownership into AppStore or erase the independent mounted-session flag merely to reduce a count.
- Report removed RPC chains, duplicate snapshot fields, and net production/test deltas.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.

- Fresh triage (2026-09-07): ready for implementation after accepted Tickets 04 and 05 under the user's explicit 04 → 05 → 06 cleanup authorization. The current tree still caches a rejected `AppStore.bootstrap()` promise, logs rather than rejects partial required-listener admission, lets Notepad fall back to `load_note_session` plus `get_vault_info` (including the remount bypass), and lets Settings own duplicate vault/semantic snapshots with bundled-to-legacy fan-out. Ticket 04's `runningPath`/`selectedPath` contract and Ticket 05's joined departure barrier are now available, so the named Ticket 06 deletions and revision/admission rules are actionable without live vault switching or workspace-owner consolidation. Exact pre-ticket working-tree archive: `/tmp/gneauxghts-ticket06-baseline.ngRHw7` (accepted post-Ticket-05 dirty tree, excluding only `.git` and dependency/build caches); audit deltas must be measured against this archive, not HEAD.

## Answer

Implemented and resolved on 2026-09-07 against `/tmp/gneauxghts-ticket06-baseline.ngRHw7`.

- `AppStore` now owns one per-slice snapshot-admission protocol. Bootstrap, Settings loads, refreshes, Apply results, and events share start-claimed revisions, so a newer operation wins in either response order and newer events defeat delayed snapshots. Successful tokens are consumed.
- Bootstrap rejection is retryable. Required listener setup is all-or-nothing: events are buffered until every listener and the payload succeed, partial listeners are removed on failure, and failed attempts do not admit editing.
- Notepad uses only the bundled bootstrap for the initial session and uses the admitted Running Vault for assets on every mount. Backend readiness and mounted-session adoption remain separate, and every existing mount/current check remains.
- Settings reads `vaultInfo` and `semanticStatus` from `AppStore`, routes bundled loads, refreshes, and Apply results through that owner, exposes bundled-load failure, and no longer fans out to equivalent RPCs. A generation guard prevents an older Apply result or error from replacing a newer Apply.
- The unmount flush remains as a documented defensive path. App-shell navigation and Restart cross the explicit barrier, but browser history and modified/default anchor navigation can still bypass it; removing the flush would therefore be unproven. The existing deterministic conflict tests continue to show that guarded departure rejects unresolved document conflicts.

Acceptance evidence:

- `appStore.svelte.test.ts`: failed payload then successful retry; partial-listener failure and cleanup; listener admission before editing; newer semantic/vault/index events before delayed bootstrap; disposal/stale lifetime; overlapping B/C results in both completion orders.
- `notepadSessionLifecycle.test.ts`: bootstrap failure admits no empty session/assets and a later retry succeeds; remount after staging B still binds running A assets; obsolete mount results and all later initialization stages remain guarded.
- `store.test.ts`: Settings consumes the shared snapshots; delayed Apply B cannot replace C; delayed bundled Settings data cannot replace newer vault/semantic snapshots; bundled failure is explicit and invokes no equivalent fallback RPCs.
- Existing `restartLifecycle.test.ts` and `workspacePersistenceService.test.ts` retain deterministic unresolved-conflict departure rejection.

Validation:

- Focused boundary/contract/fitness run: 8 files, 60 tests passed.
- Final changed-boundary rerun after listener-event buffering: 4 files, 41 tests passed.
- `pnpm run check`: 0 errors, 0 warnings.
- `pnpm test`: 125 files, 880 tests passed.
- Archive-relative whitespace check and removed-chain search: clean.
- No Rust production changed, so Rust/native execution was not material to this frontend snapshot/adoption ticket. Native relaunch would touch application lifecycle/user state and was intentionally not run; Ticket 05's restart tests remain the relevant lifecycle evidence. Issue 55 scale work was not reopened.

Archive-relative delta ledger (production/test only; planning and docs excluded):

- Production: +213 / -159, net +54. `appStore.svelte.ts` +137/-26; `Notepad.svelte` +3/-0; `notepadSessionLifecycle.ts` +11/-53; `session.ts` +0/-10; `semanticLoader.ts` +0/-20; `vaultLoader.ts` +1/-6; Settings store +54/-43; layout +1/-1; Settings page +6/-0.
- Tests: +211 / -30, net +181. AppStore +40/-13; architecture fitness +22/-0; IPC fixture +5/-2; Notepad lifecycle +25/-10; Settings store +119/-5.
- Tooling/backend: +0/-0. Architecture/domain behavior docs: +22/-0.

Removed protocol surface:

- Two duplicate Settings snapshot fields: `vaultInfo`, `semanticStatus` (now getters over `AppStore`). The planned `activeVaultPath` field was already absent in the accepted pre-ticket archive, so no deletion is claimed here.
- Initial fallback functions `loadSavedNoteFallback` and `loadAssetRootFallback` and exclusive helpers `loadSavedNoteSession` and `loadCurrentVaultInfo`.
- Settings fallback fan-out `loadSemanticSlice` + `loadVaultInfoSlice` + `loadHistoryHealthSlice`, including the equivalent semantic status/settings/debug, vault-info, and history-health RPC chain.
- Exclusive wrapper exports `loadSemanticSlice`, `loadSemanticStatusSlice`, and `loadVaultInfoSlice`.

Complexity recount: normalized authoritative owner families and grouped state dimensions are unchanged because AppStore bootstrap admission and mounted-session adoption remain legitimate separate owners/dimensions, while the removed Settings values were derived snapshots. The successful startup path remains bundled bootstrap plus mounted adoption; its one failure-only fallback handoff is gone. Existing per-slice revisions now cover all producers rather than bootstrap alone. The added Settings load error and Apply correlation generation are required local request/error state, not another backend snapshot owner.

- Orchestrator audit (2026-09-07): Standards and Spec were independently re-reviewed against the exact `/tmp/gneauxghts-ticket06-baseline.ngRHw7` archive. The audit traced retryable bootstrap, buffered/all-or-nothing listener admission and cleanup, per-slice start-time claims and one-use completion, newer-event precedence, both overlapping-operation completion orders, Settings shared getters and local-only state, explicit bundled Settings failure, initial-session fallback deletion, stale-mount guards, remount assets bound to Running Vault A after staging B, and the retained defensive unmount flush. Browser history and modified/default anchor behavior remain real ungated departure paths, so retaining and documenting that best-effort fallback satisfies the ticket rather than hiding a deletion limitation. No Standards or Spec findings remain. Independent validation passed 60/60 focused acceptance/contract/fitness tests, `pnpm run check` with 0 errors and 0 warnings, and archive-relative whitespace/isolation checks. Ticket 06 is accepted for the final cross-ticket audit.
