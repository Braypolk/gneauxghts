# Link-only Pi citations — 2026-10-17

Completed. The user explicitly waived backward compatibility after the
[single-representation prototype](pi-citation-simplification.md). The old
compatibility constraint no longer justifies preserving two citation formats.

## Implementation and deletions

Native canonical reads issue complete `[Note: …](gneauxghts-source:<issued-id>)`
Markdown citations. `ReadSource::citation` owns label escaping and optional passage
formatting; ordinary reads, mutation-base reads and terminal admission share it.
Pi's `noteReadOutput` passes that citation unchanged, including the fresh read
after an edit. Answers and standard compaction use the same Markdown form.

Removed token generation and decoding, bare-ID citation admission, legacy
Revision/Historical renderer labels, and the unused source-free provider fallback.
`createNativeModels` requires its mandatory terminal admission callback. No display
resolver, custom summary format or history rewrite/import was added. Full native
read receipts and Pi tool details remain; model-facing content omits revision/hash
proof. Every cited ID still needs a native issued receipt under current bound
authority. Search previews, fabricated labels, foreign IDs and malformed links
cannot grant source identity. Exact passage and current navigation checks remain.
Admission checks identity/location, not semantic entailment.

## Current format only

After the initial implementation, the user deleted all older chats and explicitly
requested removal of their compatibility handling. Removed the native format
marker and retirement migration, snapshot flag, read-only notice, renderer branch,
cutover-only fixtures/tests and smoke-lane registration. There is no citation
format migration, old-chat presentation or history translation. Ordinary policy
retirement, source verification and committed-effect reconciliation retain their
existing owners.

## Verification

The link-only implementation originally passed 247 frontend/chat tests, 49 native
Pi tests and 22 native app journeys. Those counts included a cutover-only frontend
test, native migration test and app journey, now deleted along with that behavior.
After removal, **246 frontend/chat tests and 48 native Pi tests passed**. Svelte
and E2E TypeScript checks passed without diagnostics. All **12 native read/chat
journeys passed**, including actual process restart, persisted source links,
historical-read navigation, exclusions and authority narrowing. The native build,
three presentation-support tests and `git diff --check` passed. A source search
confirmed no remaining cutover marker, snapshot flag, UI branch or fixture in
production code or executable tests. Current logs are
`/tmp/pi-citation-no-cutover-{chat,rust,check,build,native}.log`.

Reproduction commands for the current implementation:

```sh
pnpm exec vitest run src/lib/features/chat src/lib/architectureFitness.test.ts
cargo test --manifest-path src-tauri/Cargo.toml pi_chat:: --lib
pnpm check
pnpm test:e2e:native:build
GNEAUX_PI_PROCESS_RESTART=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/piChatNative.spec.ts
```

Native fixtures use a deterministic provider, not a live model. Physical-device
behavior is not claimed. Historical local evidence from the initial implementation
remains under `/tmp/pi-link-only-acceptance/`; it does not establish the later
removal's behavior.
