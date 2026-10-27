# Local project records

Start here to distinguish current work from development history. Tracker
conventions and retention rules are in [issue-tracker.md](../docs/agents/issue-tracker.md).
Current architecture lives in [ARCHITECTURE.md](../ARCHITECTURE.md), the
[behavior invariants](../docs/architecture/behavior-invariants.md) and [ADRs](../docs/adr/).

## Current investigations and supporting records

- [Watcher health, 2026-10-27](archive/watcher-health-2026-10-27.md): retained startup/callback diagnostics in Vault Settings, truthful periodic-scan status, restart-retained warnings and stale-update/shutdown guards. Retry and fallback scanning remain separate work.

- [Search filter native correction and result presentation](archive/search-filter-native-correction-2026-10-23.md): search preserves literal input after the trusted macOS click reproduction. The fixed-height popup retains results through typing and filters, then replaces them after a quiet period and complete retrieval; skeletons are removed. Records native and browser verification boundaries.

- [Recovery into the original note](archive/draft-recovery-in-place-2026-10-22/README.md): unfinished edits now restore the original identity without duplication; changed or unknown bases require a conflict choice. Seven native cases, three browser cases, 61 frontend and three storage tests passed. Earlier separate-copy evidence is historical.

- [Unified existing-note write permission](archive/pi-write-permission-2026-10-22/README.md): editing and renaming now share permission, folder scope and review; separate tools and native effects remain. Includes the shared tool-policy and typed publication cleanup, retained explicit targets/read receipts, native/browser acceptance and the primary-source review.

- [Manual note titles](archive/manual-note-titles-2026-10-22.md): explicit generation beside a blank title, with edit guards and ordinary saving.
- [Untitled capture naming](archive/untitled-capture-naming-2026-10-22.md): stable internal filenames keep autosaved titles blank; leaving supplies a short first-line title unless one was chosen.
- [Atlas relevance tightening](archive/atlas-relevance-2026-10-23.md): complete word-aware text matching and stricter semantic admission; the reported `blue bell` query returns its five named notes and excludes `deploy`. Supersedes the [earlier calibration](archive/atlas-relevance-2026-10-22.md).

- [Upgraded-package capability outcome](archive/package-capabilities-2026-10-21.md): all ready items assigned to this chat are implemented or have a completed bounded no-change experiment. Combined verification passed, including 65 browser specs and 12 native specs; explicit measurement/restart skips and inspector limits are recorded in the outcome. Historical execution tickets are archived; the [plan](package-capabilities/spec.md) retains scope/dispositions. [Image delivery](package-capabilities/issues/05-native-image-delivery.md) belongs to the separate image chat. [Watcher health is now implemented](archive/watcher-health-2026-10-27.md); [inspector activation limits](package-capabilities/issues/12-inspector-native-activation.md) remain `needs-triage`.

- [Bottom bar animation inventory](workspace-dock-motion/animation-inventory.md): current surface variants, editor/chat journeys, local exchanges, split layouts, display-size rules, timing, and the acceptance checklist for animation cleanup. The [existing motion spec](workspace-dock-motion/spec.md) supplies implementation context.

- [T3 Code provider authentication research](t3-provider-auth/research.md): completed source comparison of managed ChatGPT OAuth, existing CLI accounts and sensitive API-key storage, with a proposed Pi-backed connection experience. Research only; no authentication changes are implemented by this record.

- [Historical Pi vault editing assessment](pi-vault-editing-assessment/assessment.md): public API comparison and six-case staging probe. Its recommendation is now implemented and verified by the [Pi note editing slice](archive/pi-note-editing.md).

- [Historical Pi Durable prototype plan](pi-durable-prototype/spec.md): preserved experiment instructions, superseded by the [completed native prototype](archive/pi-durable-native-prototype.md) and [accepted ordinary-chat rebuild](archive/pi-chat-rebuild.md). These are not executable tickets; desktop and iOS simulator results and their limits live in those outcomes.
- [Historical chat engine reuse decision](chat-reuse-research/engine-decision.md): source and published-package investigation that led to the Pi prototype. Pi's experimental-API risk, LangGraph's bounded browser interrupt failure and Open WebUI evidence ideas remain research background. The later [ordinary-chat rebuild](archive/pi-chat-rebuild.md) adopted Pi within its agreed desktop and iOS simulator scope; physical-device acceptance remains deferred. The [earlier product scan](chat-reuse-research/product-findings.md) is also historical.
- [Historical Pi cost findings](pi-durable-chat-evaluation/cost-investigation.md): retired evaluation measurements and comparison caveats. The old optimization backlog is superseded; current performance needs fresh matched measurements.
- [iOS readiness](mobile-ios-readiness/spec.md): prioritized implementation plan for recent iPhones; background saves, safe next-launch vault selection and drag cancellation are implemented, with device validation pending. Landscape safe areas and keyboard layout are implemented and simulator-checked. Touch editing, secondary controls and image gestures are implemented. The on-device semantic runtime is bundled and product simulator workflows pass; physical memory/workflow acceptance remains open. Historical mobile chat supported both desktop providers on iOS; both protocols pass bounded simulator checks. Its Keychain persistence, native deadlines/network failures and former visual proposal review were simulator-checked; current [Pi simulator acceptance](archive/pi-chat-rebuild-evidence/ios.md) is recorded separately. Review overlap/styling/touch defects are corrected. [Container relocation](archive/mobile-ios-container-relocation.md) is corrected and verified across legacy recovery and repeated signed simulator replacement, preserving real conflicts. Physical/distribution credentials and physical/live acceptance remain in the device gate. Sync and older-device compatibility are deferred.
- [Historical chat reliability](chat-reliability/README.md): old runtime latency and citation investigations are superseded as executable tickets. Semantic entailment remains deferred and is not established by Pi citation identity admission.
- [Historical context selection](chat-context-selection/spec.md): measurements and retired implicit-editor/excerpt/frozen-history behavior. Old follow-ups are superseded; current explicit note reads/citations belong to the Pi rebuild.
- Recent [instruction audit](chat-instruction-audit/spec.md), [context reduction](chat-context-reduction/spec.md) and [tool interface](chat-tool-interface/spec.md) records support those investigations. Their completed steps are measurements, not separate open implementation queues.
- [Gemma implementation](embeddinggemma-2/spec.md): the selected LiteRT implementation and remaining release-validation limits. Earlier runtime experiments in this folder describe their original checkpoints.
- [Historical transcript recovery](chat-transcript-recovery/spec.md): retained evidence of the retired importer; Pi performs no old-chat import or managed transcript publication.
- [Note formatting on load](note-formatting-load/issues/01-formatting-before-readiness.md): retained issue requiring fresh triage against current code.

Raw chat traces, selected source snapshots and failed runs are retained while the
citation investigation needs them. Generated evidence is local; concise findings
and reproducible fixtures belong in Git.

## Deferred or awaiting fresh triage

- [Markdown parsing delays](markdown-parsing-delays/spec.md): parked at main `4d3d1d5e`; current state and four `needs-triage` follow-ups for the synchronous paragraph step, repeated background work, split-pane typing/frame delays and native focus/measurement reliability. No further implementation is underway.

- [Pi Durable native prototype](archive/pi-durable-native-prototype.md): completed isolated experiment. Its adoption verdict belongs to that historical pin; the ordinary Pi rebuild is now implemented and supersedes the executable evaluation route.

- [Architecture cleanup](architecture-cleanup/spec.md): mixed resolved and deferred tickets; older source locations and proposed designs require revalidation. This is not an automatically approved execution queue.
- [Ambient agent](ambient-agent-foundation/astra-planning-brief.md): broader foundation remains discovery only; the narrower [chat-to-note flow](archive/chat-to-note.md) is historical and its UI is retired by the Pi rebuild.
- [Settings checkpoint](settings-redesign/README.md): further design deferred.
- [Pane animation](pane-animation/validation.md#remaining-profiling): completed corrections with explicitly limited native verification and remaining profiling suggestions.
- [Atlas research](atlas-research/report.md) and [embedding alternatives](embedding-model-alternatives/research.md): retained planning/research; verify current implementation before reuse.
- [Browser harness results](headless-browser-tests/results.md) and [earlier embedding evaluation](embeddinggemma-2-evaluation/research.md): bounded historical evidence awaiting any further use, not current acceptance gates.

## Completed work and local tools

- [Pi filename editing, 2026-10-22](archive/pi-note-rename-2026-10-22/README.md): separate Rename permission, exact same-folder review, atomic no-replace movement, two-path durable proof/recovery and both-pane adoption. Includes native/browser acceptance, schema and platform limits, and a [manual guide](archive/pi-note-rename-2026-10-22/manual-testing.md) covering this tool and the earlier quality features.

- [App quality follow-up, 2026-10-22](archive/app-quality-followup-2026-10-22/README.md): recoverable capture, retrieval cues, Atlas ranked opening, scoped chat ranking, predictable formatting and measured retrieval/task cleanup. Includes validation limits; its separately planned filename tool is now implemented by the rename slice above.

- [Whole-app quality pass, 2026-10-22](archive/app-quality-pass-2026-10-22.md): connected architecture assessment, shared popup/motion/SQL helpers, dependable caret formatting and block moves, retryable search, deferred History diagnostics, and guarded credential requests. Includes bounded verification and the [note-taking friction research](../docs/research/note-taking-friction-2026-10-22.md).

- [Table interaction fixes](archive/table-interaction-fixes.md): accurate cursor movement/click mapping across multiple tables, rendered-cell formatting with shared Undo, stable cell geometry, safe popup teardown, and image picker filters. Browser, native helper and iOS compile coverage and limits are recorded.

- [Editor input and task layout](archive/editor-input-bugs-2026-10-22.md): previous-note navigation releases stale WebKit editing focus before buffer swaps; task date actions no longer wrap onto an empty line; image drops use the existing upload jobs. Browser, native and repository checks are recorded with their evidence boundaries.

- [Workspace improvements](archive/workspace-improvements.md): popup split actions,
  polished Markdown tables, drag auto-scroll and Escape cancellation, Last edited
  browsing, and slash-menu image picking. Parallel implementation and independent
  reviews are complete; validation and native chooser limits are recorded.

- [Pane-motion wait lifetime](archive/pane-motion-wait-lifetime.md): cancelled motion no longer reads destroyed workspace state. Desktop and compact navigation regressions verify cancellation, warning-free teardown, Settings focus and workspace return.

- [Pi observer lifetime](archive/pi-observer-lifetime.md): acceptance observation follows the mounted workspace across Settings, safely retires late callbacks/watches and accounts for callback failures. Four support regressions and real native navigation cover the fix; 55 native tests, 143 support tests, 1,418 frontend tests, type checks and production build pass.

- [Native pane-motion sampling](archive/native-pane-motion-admission.md): corrected the false 319px mismatch by checking source wrapping before split admission and destination wrapping from the first layout frame; a controlled regression preserves strict drift detection and the original foreground native journey passes.

- [Immutable draft bodies](archive/immutable-draft-bodies.md): synchronous body adoption removes full-string edit callbacks and Related JSON keys; saves pin exact versions, dirty/undo semantics and headless ownership remain intact. Isolated measurements and the remaining consumer audit are recorded. [Native app comparison](archive/draft-body-app-benchmark/README.md) runs before/after/after/before: long split-pane prose improves about 3 ms, smaller notes/fences stay similar, and giant-quote typing still accumulates backlog.

- [Visible-range Markdown formatting](archive/visible-range-markdown/README.md): bounded presentation traversal/emission, pane-local formatting and atomic ranges, pure/mounted/full-app before-and-after measurements, browser and native WebKit verification, and giant-quote parser profiling. The [marker-merge follow-up](archive/visible-range-markdown/marker-merge-integration.md) records parser regression coverage, focused native timing and approximately halved giant-quote edit dispatch. The [history-root follow-up](archive/visible-range-markdown/root-parser-removal.md) removes the unused root parser, with a fresh 50%/32% dispatch improvement for one/two panes and 22 native checks passing; paragraph parsing and the split-pane frame tail remain expensive.

- [Paragraph and inline Markdown parsing](archive/visible-range-markdown/paragraph-inline-optimization.md): skip impossible builtin recognizers and buffered-node tree-identity lookups. Giant-quote dispatch improves another 30%; syntax/work regressions, profiles, 24 browser checks and 22 native checks pass. Repeated background paragraph passes remain.

- [Bounded paragraph reuse prototype](archive/visible-range-markdown/paragraph-reuse-prototype.md): correctness passes in Chrome/WebKit; some Chrome giant-quote/typing gains, added dispatch cost and about 9.8 MiB retained per giant paragraph per pane. Native latency gains are inconsistent. Prototype preserved at `cfd81dc7` on `codex/paragraph-reuse-prototype`; kept off main.

- [First synchronous paragraph parse](archive/visible-range-markdown/synchronous-paragraph-optimization.md): exact ASCII autolink boundary checks remove per-character regex work. Correctness and full-app controls pass; accepted native pairs show modest giant-dispatch gains, while focus interruptions prevent a complete A/B/A and rapid typing remains slow.

- [Markdown image inventory](archive/markdown-image-inventory.md): conservative syntax-absence gating, complete incremental parsing and shared split-pane computation remove ordinary-edit cold reparses. Matched benchmarks, correctness coverage and the unrelated search-preview browser failure are recorded with the outcome.

- [Related notes redesign](archive/related-notes-redesign.md): a floating button and shared popup replace the drawer/sheet. Search, Related and Chat use the reusable container renderer with ordered items, explicit presentation states and the original pinch animation. Results are demand-driven and saved-source shortcuts respect drafts. Validation and backend scope limits are recorded with the outcome.

- [ChatGPT registration reuse](archive/chatgpt-registration-reuse.md): reconnect and disconnect retain the issued app client ID on the same host; a pinned Pi patch reauthorizes it instead of registering another app. Connected Settings hides sign-in; confirmed terminal refresh failures restore it while temporary failures preserve the connection. Source/bundled helper and Settings browser regressions pass. Existing ChatGPT-side entries require separate cleanup.

- [Chat context visibility](archive/chat-context-usage.md): composer ring and percentage with accessible token details, using Bits UI and Pi's active-context estimate. Last-known local capacity persists per server/model through unload and restart, with loaded-response refresh; SQLite retention and native unload/reload/compaction journeys pass.

- [ChatGPT sign-in experience and development signing](archive/chatgpt-sign-in-experience.md): native credential caching, navigation-safe sign-in progress, browser/callback recovery and explicit connection checks. Xcode Apple Development signing is configured for normal development and native tests; two different signed builds each pass all three live GPT-6 Luna subscription note flows.

- [Pi OpenAI model suggestions](archive/pi-openai-model-catalog.md): Settings and composer menus use the installed Pi catalog and supported reasoning levels, preserving saved/custom selections and native account availability filtering.

- [ChatGPT subscription sign-in](archive/pi-chatgpt-subscription.md): Pi built-in OAuth, native credential/refresh ownership and retained API-key selection. All three shared note journeys pass with GPT-6 Luna subscription/API-key use and the local Qwen model; the reserved namespace and missing stream-header integration defects are corrected.

- [Pi tool schema audit](archive/pi-tool-schema-audit.md): search/read/edit/create prefer Pi's supported strict sampling, with nullable optional-field handling, inherited built-in provider definitions and shared hosted/local native acceptance flows.

- [Pi search cursor correction](archive/pi-search-cursor.md): empty first-page cursors no longer fail argument validation. Actual GPT-6 Luna passes the original search/read/review/edit/citation journey and four-page native pagination in a disposable vault.

- [Full Pi uncommitted-change review](archive/pi-uncommitted-review.md): independent Standards/Spec review, repaired acceptance tooling and portable research fixtures, and fresh full unit, native and browser verification. Commits separate retired code, core adapters, chat UI and retained research.

- [Pi create/edit adapter cleanup](archive/pi-create-edit-adapter-cleanup.md): creation uses Pi's saved arguments without a candidate memo; explicit create/edit review shapes preserve pending decisions through Pi's document upgrade. Shared publication and authority validation remain intact.

- [Pi note creation](archive/pi-note-creation.md): explicit creation permission, default review, exact destination/content preview, native create-only publication and stable restart recovery. Shares Pi and the existing publication flow. All 318 frontend tests, 21 desktop journeys, two Settings browser journeys and native permission/recovery/architecture checks pass.

- [Pi editing experience fixes](archive/pi-editing-experience-fixes.md): all five assessed issues are fixed: permission selection races, committed-edit Stop feedback, repair-warning visibility, whitespace and section context. Publication flow and authority validation are preserved. All 307 frontend tests and 16 native editing/publication journeys pass, including restarts and both review layouts.

- [Pi chat adapter cleanup](archive/pi-chat-adapter-cleanup.md): Pi creates app documents atomically, selections use watch-backed metadata/model state, and progress frames retain loaded history. Removes opening-time initialization and redundant reads/merges. All 250 chat/frontend architecture tests and 11 native editing/restart/compaction checks pass; publication implementation is unchanged. Includes the supporting orchestration assessment.

- [Remaining old-chat compatibility cleanup](archive/pi-chat-compatibility-removal.md): removed native authority/grant upgrades, v2 review migration, retired-create decoding, the forgotten-chat variant and the localStorage pointer importer. Current review, citation proof and publication recovery remain; 351 frontend tests, 635 Rust tests, 19 native architecture checks and 15 real macOS journeys pass.

- [Link-only Pi citations](archive/pi-link-only-citations.md): native reads, final answers and summaries share one Markdown representation. Removed legacy token/label compatibility and the provider fallback. After the user deleted older chats, removed the format marker, retirement migration, read-only notice and cutover tests. Only the current format remains; native read proof and permission checks still apply.

- [Historical Pi citation simplification](archive/pi-citation-simplification.md): removed unused answer-source metadata and model-facing read proof, and preserved the single-representation prototype. Its compatibility-dependent verdict is superseded by the link-only implementation above. Native read-backed admission remains.

- [Pi write defaults in Settings](archive/pi-write-defaults-settings.md): AI & Chat exposes the existing vault Off/Always permission and review policy. Chat synchronization, restart persistence, Temporary isolation and pending-edit revocation are verified.

- [Fresh Pi post-edit citations](archive/pi-post-edit-citations.md): committed edits return an authorized canonical read and fresh citation for the final confirmation. Failed reads preserve committed receipts; native current/historical citation and restart journeys pass.

- [Chat edit diff layout](archive/pi-edit-diff-layout.md): Settings → Appearance offers Inline (default) and Side by side, saved on this device. Browser reload and native pending-review/process-restart acceptance pass.

- [Pi edited-note citation feedback](archive/pi-source-navigation-feedback.md): successful historical-source navigation uses a local informational status instead of a retained chat error. Native split-pane and single-pane note/return journeys pass alongside editing and restart acceptance.

- [Readable Pi edit review](archive/pi-edit-review-readability.md): plain-text Before/After blocks and changed-word highlighting replace the technical patch as the default review. Exact details remain available; native approval and restart behavior are unchanged.

- [Concrete Pi editing cleanup](archive/pi-editing-cleanup.md): removed agent-create support, moved exact review display data into Pi working state, and delegated argument repair to the public Pi tool. Publication flow is preserved. Includes native restart, authority, receipt and editor-owner acceptance.

- [Architecture after Pi editing](archive/pi-editing-architecture-review.md): historical follow-up assessment; its three concrete cleanups are implemented. Native effect proof, editor leases and the atomic publication continuation remain justified; broader publication-boundary reorganization was not pursued.

- [Pi note editing slice](archive/pi-note-editing.md): public Pi replacement staging, durable exact review, explicit write permissions and native publication. Six actual macOS editing journeys pass, including pending review across a process restart. Pi owns progression; native effect proof and editor exclusion remain required.

- [Combined Pi merge readiness](archive/pi-combined-merge-readiness.md): fresh combined checks, corrected scroll/touch/IME regressions and restart test readiness; all browser scenarios covered after focused reruns, native domain guarantees retained. Ready for the agreed desktop merge scope.

- [Shared search/hash cleanup](archive/pi-shared-search-cleanup.md): extracted the retained interactive search and stable Pi receipt hash, removed retired agent evidence protocols, and verified native domain guarantees.

- [Pi pre-merge audit](archive/pi-premerge-audit.md): independent Standards/Spec review, startup quiesce and diagnostic fixes, default native acceptance activation, dead UI/native helper cleanup and merge considerations. Covers the effective checkout, including untracked rebuild files.

- [Pi adapter alignment](archive/pi-chat-adapter-alignment/outcome.md): all six tickets implemented and tested on Pi 1.3.0. Standard provider/options, sanitized diagnostics, Chord observation cancellation and incremental list metadata preserve native permission, citation, publication and shutdown guarantees. Current-source frontend/native checks, all five desktop gates and bounded simulator/reopen acceptance pass. Matched discovery/list counts improve; no total storage or latency claim. Physical-device/live-hosted acceptance remains deferred.

- [Pi ordinary-chat rebuild](archive/pi-chat-rebuild.md): all ten tickets implemented; ordinary chat uses Pi for generic execution/history/standard compaction and native vault owners for domain authority. Desktop and simulator local-model/fault/publication/recovery acceptance complete. Physical-device testing is deferred; initial model tools remain read-only with a tested future create/update foundation. No legacy parity or performance-win claim.

- [Pi Durable interactive evaluation outcome](archive/pi-durable-chat-evaluation/outcome.md): bounded historical acceptance, original failures and resource limits. The later ordinary-chat rebuild supersedes its deferred-adoption recommendation; committed working records are recoverable from Git at `64cc3ff6`.

- [Background native testing](archive/native-background-testing.md): native E2E startup/restarts and focus permissions default to background operation; four smoke files pass, while actual focus/paint checks require explicit foreground opt-in.

- [Activity read links](archive/chat-activity-read-links.md): actual note and passage reads show clickable note names and previews, with durable replay and normal citation navigation; frontend, backend and native macOS coverage completed.

- [Chat evidence freshness](archive/chat-evidence-freshness.md): corrected false change detection from legacy identity bookkeeping, timestamps and internal settlement; actual source changes and access revocation remain blocked.

- [Historical chat-to-note](archive/chat-to-note.md): retired ordinary-chat feature; the earlier implementation provided faithful whole-answer/selection saves, normal-editor review, durable pending drafts, explicit existing-note additions and conversational refinement. Native review-switching fixture readiness and Retina restoration are corrected. The [cleanup audit](archive/chat-cleanup-audit.md) records the current gate. Local-model journeys pass; physical iOS validation remains unverified.

- [Structured answer source recovery](archive/structured-answer-source-recovery.md): unissued selections become explicit unavailable markers while preserving valid answer text and citations; stale or revoked real evidence still blocks delivery.
- [Server reasoning options](archive/server-reasoning-options.md): local controls use advertised LM Studio options and defaults; outgoing reasoning is revalidated and mapped to the compatible transport.
- [Compatible-model tool schemas](archive/lm-studio-tool-schema-regression/validation.md): root argument definitions restored for combined read/proposal tools; capability isolation and branch validation retained, with live streaming acceptance on both Qwen GGUF variants.
- [Compatible-model system messages](archive/lm-studio-system-message-regression.md): assembled app context is combined into one opening system message for strict chat templates; full structured follow-up coverage includes tool continuations and formatter retries.
- [Tool activity details](archive/chat-tool-error-details.md): corrected event field casing that collapsed calls and hid failure explanations; saved events remain readable. The investigated research failure was the shared evidence allowance, and its chat completed.
- [Continuous research compaction](archive/continuous-research-compaction.md): running agents compact context and continue productive tool use without default cumulative quotas; original requirements, tool pairs, usage and freshness checks survive. Actual `research_notes` completed two live GSQ-RCO runs, each with 73 reads, four worker compactions and six validated cited facts, including parent handoff continuation. Native development acceptance completed six conversation turns covering research, fresh reads, reviewed edits, citations, restart and Stop/Retry recovery; two slow attempts required cancellation.
- [Adaptive evidence allowance](archive/adaptive-evidence-allowance.md): historical context-scaled quota, superseded by continuous research compaction.

- [Browser dock regressions and WDIO 10](archive/browser-dock-wdio10.md): stationary popup placement, compact search controls, coordinated split capture and interruption continuity, and unclipped chat menus with real desktop/phone pointer coverage.

- [Split pane motion consistency](archive/split-pane-motion-consistency.md): all split choices share the existing pane/dock clock; current and previous chat destinations mount directly, and measured dock bounds avoid reversals at width caps.

- [Accepted proposal conflict prompt](archive/proposal-self-change-conflict.md): canonical commit receipts prevent normalized chat edits from being mistaken for external changes; later typing and genuine conflicts remain protected.

- [Compact search control motion](archive/compact-search-row-motion.md): right-anchored buttons, leftward option reveal and smooth query-row/dock height changes, verified in the native Mac development app.

- [Narrow macOS search focus](archive/macos-search-focus.md): deferred CodeMirror wrap correction could steal focus from search in WebKit; guarded the selection writer and added a native regression.

- [Mobile code audit](archive/mobile-code-audit.md): full thread review for correctness, ownership, reuse and duplication; corrected system-Python runtime staging and pane-owned link actions, with full unit/native and focused mounted validation.
- [Split control continuity](archive/mobile-split-control-motion.md): stable header sizing/spacing, coordinated compact tab-selector motion and independent search-panel/circle geometry; simulator app updated.
- [Mobile transition follow-up audit](archive/mobile-transition-audit.md): retained outgoing search rows and consistent split-action focus; other affected controls and layouts checked, simulator updated.

- [Stopped on-device mobile chat investigation](archive/mobile-on-device-chat/README.md): historical findings and artifact pins; superseded by desktop-equivalent remote chat. Cancelled chat and superseded semantic probe tooling were removed on 2026-10-12; product tests and the remote-chat protocol fixture remain.

- [Rig 0.44 upgrade](archive/rig-upgrade-2026-10-11.md): completed after the 0.41 comparison; the three existing [evidence fixture failures are resolved](archive/completed-work.md#evidence-regression-fixtures).

[Completed-work record](archive/completed-work.md) replaces the redundant completed
specs, tickets, coordination reports and intermediate artifacts. It preserves
outcomes, material validation limits and the Git revision for original records.
Old designs are historical; architectural claims enter current docs only after
checking the current implementation and applicable ADRs.

[Responsive capture tools](responsive-screens/README.md) can generate fresh visual
evidence.
