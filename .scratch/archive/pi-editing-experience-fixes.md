# Pi editing experience fixes — 2026-10-17

Completed all five issues from the editing experience assessment. The original
controlled probes reproduced a permission selection race, hidden committed edits
after Stop, dropped repair warnings, invisible whitespace changes and missing
section context. Those probes are superseded by retained regression tests.

## Corrections

1. First-use editing permission retains the originating selection lifetime and
   intended newly created conversation. Delayed creation, delayed selection and
   disposal all prevent a superseded action from sending a write-policy command.
   The normal first-use grant still binds the actual new conversation. Existing
   native authority ID, revision, scope and grant validation are unchanged.
2. Stop after a confirmed publication shows “Edit applied before the response
   stopped.” The edit task's retained terminal result supplies proof independently
   of the generic tool's aborted result. Selection scans terminal publication
   tasks and observes public task commits, joining owner IDs to immutable tool
   entries. This is disposable presentation state; no new durable outcome ledger,
   native effect or cancellation coordinator was introduced. Generation stays
   stopped, publication happens once, and feedback survives reopening.
3. Committed repair warnings survive publication-task result reduction and reach
   the tool's model output and visible history. They appear outside the collapsed
   activity even for an unopened note, Stop reconciliation and reopening. A
   warning remains a successful write and never permits replay.
4. Whitespace-only review detects internal spacing, indentation, tabs, nonbreaking
   spaces and line-break changes. Both layouts expose changed whitespace with a
   legend, retaining exact underlying before/after text and candidate bytes.
5. Reviews retain a small preceding excerpt from Pi's patch, preferring a nearby
   heading. Managed frontmatter context, file/hunk headers and trailing unchanged
   text remain out of the default display. The technical diff remains available.
   Section context is limited to what Pi includes in its patch; no extra note
   reads or reconstructed document are needed.

## Ownership

`piConversationView.ts` owns selection guards and the temporary result projection;
`piActivity.ts` / `PiActivityGroup.svelte` present the retained outcome;
`editReviewChanges.ts` / `PiEditReview.svelte` present the existing exact patch.
`publication.ts` now retains warning presentation and exposes a pure terminal
result reader. Pi retires task working documents at settlement, so those documents
are not a source of historical outcome proof.

Compared with this task's starting copy, the publication phases, native approval,
effect ordering, reconciliation, editor leases and adoption are unchanged. The
authority adapter is byte-identical. No native Rust implementation changed in
this task. Current guarantees are recorded in `ARCHITECTURE.md` and the behavior
invariants rather than only in this historical record.

## Verification

- All **307 tests in 25 frontend suites** pass, including chat and architecture
  fitness checks. New regressions exercise real Pi Harness ownership, immutable
  entries, review approval, Stop and reopen, with controlled native results.
  Delayed feedback loading cannot repopulate a replaced selection. Before-effect
  Stop/rejection cases show no applied notice. Warning tests cover normal output
  and Stop reconciliation with one native publication.
- Each of the five failures had an observed failing regression before its fix.
  The initial warning-after-Stop test needed its native reconciliation fixture to
  return the same warning as publication; this corrected the test, not the flow.
- `pnpm check`: Svelte reports **0 errors / 0 warnings**, and E2E TypeScript passes.
  `git diff --check` passes.
- Native debug build succeeds. All **16 actual macOS background native journeys**
  pass in disposable vaults: 10 ordinary editing and 6 publication-owner checks.
  This includes Settings defaults/revocation, exact review, apply/discard/Stop,
  changed base, source navigation, Temporary scope, real process restarts,
  receipt replay, dirty human editor protection and Settings remount ordering.
- The new native review journey checks section/space visibility in both layouts,
  applies once and checks the exact saved spacing. Actual native screenshots of
  both layouts were visually inspected in the split pane.

Native runs use `GNEAUX_PI_PROCESS_RESTART=1` with `runNativeSpecs` for
`piChatEditing.spec.ts` and `piChatPublication.spec.ts`. The sandbox's local-port
restriction required the normal escalated test execution. Existing embedded
driver/restart cleanup warnings did not prevent completion; all background focus
assertions passed. Selected screenshots and logs are local under
`/private/tmp/pi-editing-fixes-acceptance/`.

Permission timing and post-commit Stop/warning injection are deterministic Harness
regressions rather than native failure-injection journeys. No physical iOS or live
model acceptance is claimed. No real user vault was modified by acceptance tests.
