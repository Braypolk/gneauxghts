# iOS chat container relocation

Implemented and simulator-verified 2026-10-11. Signed app replacement moved the disposable iPhone 17 Pro data container while retaining its vault. Absolute chat projection/proposal paths still referenced old containers: transcript retry falsely reported an external edit and retained create Keep failed with `No such file or directory`.

## Correction

ChatService's private `chat/relocation.rs` runs before interrupted commit/run recovery and transcript observations. A vault-local root receipt and the closed set of location fields migrate in one immediate SQLite transaction: projection receipts, proposal targets/previews/commit intents, source note locations, retry context and active-note location. IPC paths remain absolute. Authored text, URLs, hashes, permissions and proposal statuses are unchanged. This is a startup binding policy, not a second canonical write path or live vault switch.

For databases without a root receipt, a previous root requires the exact generated transcript suffix and a surviving managed conversation identity within the current vault. Several historical containers can be recognized. External paths, parent traversal and symlinked proof outside the vault cannot supply migration authority. Unknown legacy roots remain unresolved; migration does not guess from arbitrary proposal paths. A previously detached relocated transcript clears only when every publication receipt matches current bytes. Missing or edited files still require ordinary conflict recovery.

Update commits resolve Note Identity in the Running Vault before the existing canonical planning/NoteTimeline path, retaining permission and base-hash checks. Interrupted commit targets rebind before existing filesystem-proof recovery: matching content converges status, changed/missing targets conflict, and recovery never reapplies writes.

## Simulator evidence

Target: `Gneauxghts Semantic Test`, iPhone 17 Pro, iOS 26.4.1 (23E254a), Xcode 26.4.1 (17E202), UDID `3E6C179B-10D5-4FA2-8773-207EB27951BF`. Normal Xcode signing, same bundle ID `com.braypolkinghorne.gneauxghts`; synthetic notes/keys only. OpenAI used the authorized local Responses fixture; no live API calls.

Three actual signed installs changed the data-container UUID:

1. Existing broken legacy vault: `EB186341…` → `49CC6B79…`. All 136 transcript receipts rebound. Both old timeout chats became non-detached and explicit retries completed through their original providers. The fixture's first timeout counters were primed with separate synthetic HTTP requests to test recovery without repeating the prior 15-minute deadline measurement. Original retained create `proposal_bd1ac022969a3db3fb35` and update `proposal_572f8e84ace17531725e` passed visible Keep; the update preserved unrelated text.
2. Recorded-root migration: `49CC6B79…` → `A2676468…`. Four newly staged create proposals survived: both providers passed visible Keep and Undo. Keep wrote exactly `Synthetic mobile proposal.\n`; Undo created no target and durably dismissed. An OpenAI update survived, opened its styled editor, and Keep changed only the synthetic paragraph while retaining unrelated text. No target was created before explicit Keep.
3. Ordinary feature-off build: `A2676468…` → `64F994A5…`. Launched without fixture/credential overrides. All persisted location columns checked had no stale container paths; committed files, absent Undo targets and genuine conflict states survived.

Before the second install, one dedicated transcript received an external synthetic edit and another index was moved to a retained backup. After relocation, native loading marked both detached and attempted sends failed with `Resolve the externally edited transcript before continuing this chat`. The edited bytes remained present and the missing index stayed missing through the third install. Migration did not silently restore either.

Review actions used Safari Web Inspector against the actual mounted WKWebView, with center hit tests and Simulator screenshots. Card actions and inline Keep remained unobstructed with 44-pixel height. This establishes native rendering, handlers and persistence, not physical finger/IME behavior. Both fake Keychain keys reported `configured: false` before cleanup; the fixture server was stopped and the ordinary signed app restored.

## Checks and limits

- Five new production-path relocation regressions pass: legacy/recorded-root moves and repeated startup; missing/edited transcript conflicts; canonical create/update Keep (including changed-base and occupied-create conflicts); filesystem-proof-only interrupted commit convergence; atomic rollback under an injected database failure; outside/traversing targets and unchanged authored text.
- Broader chat suite: 94 passed, two intentionally ignored. Proposal-filtered suite: 16 passed (overlaps chat regressions). Backend architecture fitness: 21 passed. Its existing restart assertion now follows the previously introduced relaunch wrapper to the same blocking lifecycle owner.
- Fixture and ordinary signed iOS simulator builds pass; both pass strict/deep signature verification. Rust formatting and diff whitespace checks pass. Existing blake3 deployment-version/debug-unwind linker warnings remain.

Physical-device app-update/distribution and lifecycle acceptance remains in [issue 08](../mobile-ios-readiness/issues/08-ios-device-release-gate.md). Interrupted commit proof cases ran through the real host ChatService/filesystem and canonical commands; this simulator pass did not interrupt a process during an actual commit. Unknown/unprovable legacy roots fail closed. SQLite remains authoritative; no manual database repair or conflict bypass was used.

Selected synthetic database snapshots, request logs, exact review results and build/check logs remain local under `/private/tmp/gneauxghts-ios-remote-chat/relocation-*`. The original failure is recorded in [network/review validation](../mobile-ios-readiness/chat-network-review-validation.md).
