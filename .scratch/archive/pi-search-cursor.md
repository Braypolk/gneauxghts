# Pi search cursor correction — 2026-10-18

Completed the reported GPT-6 Luna search loop. The first-page call supplied
`cursor: ""`; the tool schema required at least one character, so Pi rejected
the arguments before native search. The previous local-model acceptance did not
exercise this argument shape.

The search tool now documents that cursors are opaque `nextCursor` values from
the same query, and that omitted or empty cursors start the first page. The
adapter omits an empty cursor before native invocation. Pi's existing optional-null
normalization is unchanged. Nonempty cursors still reach native query/authority
validation unchanged; fabricated and stale tokens remain errors.

## Verification

- Before the fix, the new real-Pi Harness regression failed for empty first-page
  arguments and recovery using an empty cursor. Both pass after the fix. Existing
  null normalization, exact token forwarding and native invalid-cursor error
  propagation/recovery are covered; all 14 note-tool tests pass.
- All 312 chat tests across 24 files pass. `pnpm check` reports zero Svelte
  errors/warnings and passing E2E TypeScript.
- Full `pnpm test` passes 32 support tests and 1,298 frontend tests across 151
  files; the initial sandbox attempt could not bind support-test loopback
  listeners, and the authorized host rerun passes. Ordinary production build and
  `git diff --check` pass. Six focused runner/presentation checks also pass,
  including background admission of the new hosted lane.
- Actual **GPT-6 Luna**, through the ordinary native OpenAI Responses transport
  and a generated disposable vault, passes both hosted journeys (20 seconds):
  - Original prompt: “In edit check change the walk to 45 minutes”. Luna emits
    `search_notes` with `cursor: ""`, limit 10 and query `edit check walk`;
    search, read and edit all succeed without tool errors. The file retains
    30 minutes until UI approval, then contains 45 minutes with the unrelated
    reminder preserved. The final fresh citation opens the edited note.
  - Explicit pagination: Luna starts with `cursor: ""` and limit 1, follows three
    native continuation tokens unchanged, ends at null, reads all four notes and
    reports their four beacon codes with citations. All four searches succeed.
- Live acceptance uses the existing pinned debug E2E binary (no Rust changes),
  current frontend, native NoteTimeline, review and citation navigation. The
  existing configured OpenAI credential is passed in process memory through the
  debug environment override; it is not written to reports or the fixture
  Keychain. User notes and Settings are not used as fixtures. The runner closes
  its owned app/server and removes the generated vault.

Reproduction: supply `OPENAI_API_KEY` to the debug native process, then run
`GNEAUX_PI_HOSTED_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs hosted`.
The opt-in test is `e2e/specs/native/piChatHosted.spec.ts`; deterministic default
lanes do not make hosted requests. Sanitized local fixture reports and native
runner output are in `/private/tmp/pi-cursor-luna-acceptance/`. This is bounded
desktop live-model acceptance, not physical-device or broad model-quality proof.
