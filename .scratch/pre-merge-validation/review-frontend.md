# Cumulative frontend Standards and correctness review

Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b` against the current working tree, including intentional untracked source. Reviewed with `git diff cb4d4c02 -- src e2e`, narrowed diffs, current implementation/caller reads, and `git ls-files --others --exclude-standard src e2e`. This is a cumulative review, not a review of the last performance change alone.

Result: **No actionable Standards or correctness finding confirmed in this assigned scope.** This is a source-review assessment, conditional on the coordinator's final integrated validation. No source edits, builds, tests, benchmarks, or browser/native runs were performed by this reviewer.

## Standards and requirements

Read the repository code-review skill, `AGENTS.md`, `docs/agents/domain.md`, domain vocabulary in `CONTEXT.md`, `ARCHITECTURE.md`, and applicable behavior invariants. Applied the fixed Fowler smell prompts as judgment questions rather than mandatory refactor requirements. The relevant hard ownership rules are AppStore's private snapshot admission, one aggregate chat transition, Running Vault versus Next-launch Vault Selection, dirty-document task routing, durable request identity, and explicit related-note context. The phase spec is `.scratch/pre-merge-validation/spec.md`.

The architecture changes in this scope have an observable ownership benefit:

- AppStore now privately admits Settings bundles and vault selections. Settings no longer coordinates the admission protocol through loader/coordinator callbacks or maintains a second shared snapshot authority.
- ChatController routes admitted effects and backend events through one aggregate transition, including visible conversation projection. Splitting tests did not create another production owner or retain the old parallel projection path.
- Atlas visibility writes use a dedicated API rather than reading and rewriting unrelated chat defaults. The shared catalog removes a frontend/native catalog copy.
- Task mutations share the existing routing/admission policy without exposing another general command framework. Stale post-commit results trigger a current projection refresh, not another canonical write.
- The browser backend has per-instance state and an explicit command contract. Unknown commands and note identities fail rather than being accepted by a catch-all mock response. The declaration file consumes the same contract instead of copying it.

I found no demonstrated caller burden or duplicate state in these changes that warrants an additional abstraction or a speculative rewrite before integration.

## Inspection ledger

| Area | Inspection performed | Specific correctness checks |
| --- | --- | --- |
| App bootstrap and admission | Full production diff and current `appStore.svelte.ts`/new `listenerScope.ts`; attachment/admission tests | Partial listener acquisition, payload failure, disposal with late attachments, per-slice event/snapshot ordering, overlapping vault operations, listener cleanup ownership |
| Settings | Full production diff and affected current methods in `store.svelte.ts`, removed loaders/coordinator, `ChatSettingsPanel.svelte`, `semanticStatus.ts`; affected store regression cases | Lifetime checks after bootstrap and async work; view/history/settings revisions; serialized writes; mutation versus old bundle; stale Missing Note pages/errors; failed setup; committed warning reporting; staged vault semantics |
| Chat | Full production diffs and current controller/machine paths, API, composer/persistence, configuration, panel/helper and proposal-visibility changes; new lifecycle tests and selected configuration/event/proposal tests | First-send creation ownership, selection/configuration supersession, promotion and failed-send content retention, synchronous subscriber reentrancy, receipt versus early stream/terminal delivery, duplicate/stale terminal identities, resumed request provenance, permission correlation, disposal/listener retry, defaults versus Atlas settings |
| Atlas | Full production diff and affected current initialize/refresh/search/poll/cache methods; lifetime and search regressions | Joined initialization, stale refresh finalizers, detached-event revalidation on reopen, immediate request invalidation before debounce, stale error suppression, visibility query identity, next-launch selection not invalidating the Running Vault graph |
| Tasks | Full `taskListStore.svelte.ts` production diff and current mutation/projection/lifecycle paths; routing and stale-response regression cases | Dirty open-document routing, canonical fallback, per-note mutation ownership, post-commit current-view refresh, filter/group/load admission, full-load versus newer group patch, stale reorder failure, due-date error visibility, bootstrap/disposal |
| Search, related, wikilinks | Production diffs and affected request/admission/parser call sites; selected regressions | Invalidation during debounce/empty query, stale success/error rejection, recent-note acquisition ownership, UTF-16-to-codepoint excerpt offsets, stale wiki suggestion membership. Editor/parser implementation belongs to the document/editor review |
| Shared contracts | `historyCommand.ts`, changed IPC/Timeline fixture tests, shared model catalog and frontend consumer | Own-property error classification, exhaustive fixture union check, retained real consumer assertions, dedicated settings argument shape. Native implementations are independently reviewed by the backend owner |
| Browser backend and support | Full `src/lib/e2e/browserBackend.ts` diff and affected current handlers; new backend contract/test, browser module export, chat fixture, native contract probe/contract | Save target captured before an awaited hold, read does not change active save identity, exact listener ownership, native-like string save failures, strict unknown-command behavior, explicit overrides, DEV/E2E installation boundary, native probe observes production events rather than emitting them |
| Browser application scenarios | Full new chat-controls scenario and settings fixture changes; sampled associated browser changes | Failed active-note flush retains unsent chat, streamed first send and evidence opening, correlated permission controls, local capabilities/defaults, explicit settings command overrides |
| Other frontend tests | Test names and changed assertions sampled for app preferences, editor text-size helper, contracts, Settings panels, architecture fitness, History component/session reductions | Distinguished low-value/duplicate removal from executable async and persistence regressions; no skip/disabled-test mechanism or production fallback introduced to make the retained tests pass |

New source was not omitted merely because it is untracked. Relevant additions inspected include `app/listenerScope.ts`, `app/testFixtures.ts`, `contracts/chat-model-catalog.json`, `e2e/browserBackendContract.ts`, `e2e/browserModules.ts`, `e2e/chatControlsFixture.ts`, `e2e/nativeContractProbe.ts`, `e2e/nativeContractProbeContract.ts`, `e2e/browserBackend.test.ts`, and the split chat test/support files.

## Limits and handoff

- Document/editor/workspace/proposal ownership and the Notepad integration are assigned to the other frontend reviewer. I inspected adjacent chat/task/lookup consumers, but do not substitute this report for that review.
- Backend durable policy, command implementations, native process/restart infrastructure, clean-checkout packaging, generated-artifact inclusion, and merge integration with local main remain with the coordinator/backend/harness reviewers.
- Existing large fixture bodies and every assertion in every retained frontend test were not exhaustively reread. The ledger distinguishes full production-path review from selected tests and sampled browser scenarios. Prior reduction reports were navigation evidence, not a substitute for checking current implementations.
- No performance, passing-test, browser, native, or clean-install claim follows from this source review. Use the coordinator's actual gate results. No remote CI status was checked.
