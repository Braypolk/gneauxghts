# iOS chat network failure and proposal review

2026-10-11 follow-up to [remote chat](remote-chat-validation.md) and [Keychain validation](keychain-validation.md). Target: iPhone 17 Pro simulator, iOS 26.4.1 (23E254a), Xcode 26.4.1 (17E202), disposable `Gneauxghts Semantic Test` (`3E6C179B-10D5-4FA2-8773-207EB27951BF`). All requests and notes are synthetic. OpenAI uses the user-selected loopback Responses fixture; no live API call or real credential is involved.

## Transport checks

Requests run through WKWebView → native Tauri IPC → production ChatService/AgentRuntime → real loopback HTTP sockets. The [retained fixture](remote-chat-fixture.py) interrupts structured function arguments before a formatter call completes. Neither protocol may persist that fragment as a successful answer.

| Scenario | Compatible server | OpenAI Responses |
| --- | --- | --- |
| TCP reset halfway through SSE (`IOS_LOSS`) | Error, empty durable answer | Error, empty durable answer |
| EOF before provider completion (`IOS_EOF`) | Error, empty durable answer | Error, empty durable answer |
| Explicit retry after each failure | Complete | Complete |
| Stalled response before headers (`IOS_TIMEOUT`) | Error at 900,005 ms; `timeBudgetExceeded` | Error at 900,005 ms; `timeBudgetExceeded` |
| Refused connection while endpoint is unavailable | Error; explicit retry after restoring endpoint completes | Error; explicit retry after restoring endpoint completes |

Midstream resets reported `error decoding response body`; incomplete EOF reported `the reply ended before the provider ended it`. All four retries returned the formatted synthetic answer. Requests stayed with their selected provider. These are controlled native transport failures, not measurements of physical Wi-Fi/cellular transitions or a real provider outage.

The pinned `rig-reqwest` shared client uses the default reqwest 0.13.2 builder. Its total, read and connect timeout defaults are `None`. Chat has an application-owned 15-minute total agent deadline in `AgentRunLimits`, enforced while awaiting the next stream item. The timeout probe holds headers for 930 seconds and uses the unmodified production limit; no accelerated deadline or production HTTP setting was introduced.

Both stalled turns persisted an empty answer and `The agent stopped after reaching its time limit.` OpenAI’s explicit retry completed. The compatible timeout retry was accidentally redirected to a fresh fixture counter, stalled again, then interrupted by app replacement. Retrying the original conversation after replacement was blocked by the container-relocation defect below; compatible timeout retry is therefore not a passing result. Both providers did pass explicit recovery after midstream failures and refused connections.

`IOS_PROPOSE_BREAK` completes a create-proposal tool call, then closes the next provider connection before headers. The compatible-server turn became an error with one durable pending proposal. The target file remained absent. This establishes safe staging followed by failure; it is not an exactly-once claim for interruption during a canonical commit.

## Reproduced UI defects and corrections

The Related bottom-sheet toggle overlaid the mobile chat proposal card. At the center of Keep (`x=346.98`, `y=646.5` CSS pixels), `elementFromPoint` returned Related. The update card's Review in editor center was covered as well. The bottom-sheet host now appears for an active editor rather than an active chat; desktop side placement is unchanged. Card actions also use the existing coarse-pointer 44-pixel target policy.

An update proposal opened the real editor, but its additions/removals and inline buttons were unstyled. `features/proposals/review.css` existed without any import. Notepad now imports it alongside its global CodeMirror styles. Inline hunk Keep/Undo buttons have 44-pixel minimum dimensions for coarse pointers.

The mounted browser regression covers an unobstructed create card, dismissal without committing, explicit update-editor review, loaded change styling, touch target dimensions and hunk Undo. The existing settings touch check now uses the current `Refresh server models` label. All seven secondary-touch browser tests pass; 49 proposal controller, orchestration and workspace unit tests pass. Svelte/E2E checks report zero errors/warnings. Normal Xcode-signed fixture and ordinary simulator bundles build successfully. Existing deployment-version/debug-unwind linker warnings remain.

## Native review validation

Fresh create proposals pass mounted-card Keep and Undo with both providers. Before Keep, their canonical targets were absent. Compatible Keep wrote `Synthetic mobile proposal.`; OpenAI Keep wrote the manually reviewed replacement `Reviewed OpenAI fixture proposal.`. Both durable statuses became `committed`. Both Undo targets remained absent with `dismissed` status. Card Keep/Undo measured 52.03×44 and 52.69×44 CSS pixels, with unobscured center hit tests.

Fresh compatible-server update proposals opened the actual editor through Review in editor (109.38×44). Simulator screenshots show red removal and green addition styling. Inline Keep (54.17×44) and Undo (55.44×44) passed center hit tests. Keep changed only `Original synthetic paragraph.` to `Updated synthetic paragraph.`, preserving `Unrelated text stays.`, and durably committed. Separate Undo left the original note byte content unchanged and durably dismissed. The earlier target remained unchanged through staging and the long deadline probes (full-file SHA-256 `a0b37da4ecf0e71971f54a388a76e16005166ab394a37197761dd83cc4cb3bdc`). OpenAI update-editor review was not repeated in this pass; both providers’ create review and the shared update editor were exercised.

## Container relocation failure (subsequently corrected)

Installing the normally signed replacement preserved simulator data but changed the application data-container UUID. Existing managed transcript paths and pending proposal targets/previews still referenced the old absolute root. Retrying an old conversation raised `Resolve the externally edited transcript before continuing this chat`; Keep on an old create raised `No such file or directory (os error 2)` and created no file. Undo subsequently dismissed that proposal. Fresh chats/proposals in the new root worked normally. The subsequent [relocation correction and simulator validation](../archive/mobile-ios-container-relocation.md) resolves this failure, including the old compatible timeout retry and retained create/update Keep. This paragraph records the original failing checkpoint. No database rewrite or conflict-check bypass was used.

Simulator UI actions are performed through Safari Web Inspector against the mounted app, with hit tests and Simulator screenshots. This validates native WKWebView rendering and the application handlers; it does not establish finger input, software-keyboard/IME or physical-device gesture behavior.

Raw synthetic request logs, read-only database snapshots and build/test logs remain local under `/private/tmp/gneauxghts-ios-remote-chat/`. Physical device/distribution, live-provider, LAN privacy/ATS, radio transitions, suspension/lock and interruption during actual commits remain in [issue 08](issues/08-ios-device-release-gate.md).

## Cleanup

Both synthetic Keychain keys were deleted and reported `configured: false`. Both loopback fixture servers were stopped. The ordinary Xcode-signed feature-off app containing the UI fixes was installed and launched without fixture or credential environment overrides. Synthetic notes, database snapshots and request logs are retained for the relocation investigation.
