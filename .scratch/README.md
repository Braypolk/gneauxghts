# Local project records

Start here to distinguish current work from development history. Tracker
conventions and retention rules are in [issue-tracker.md](../docs/agents/issue-tracker.md).
Current architecture lives in [ARCHITECTURE.md](../ARCHITECTURE.md), the
[behavior invariants](../docs/architecture/behavior-invariants.md) and [ADRs](../docs/adr/).

## Current investigations and supporting records

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

- [Pi Durable native prototype](archive/pi-durable-native-prototype.md): completed isolated experiment. Its adoption verdict belongs to that historical pin; the ordinary Pi rebuild is now implemented and supersedes the executable evaluation route.

- [Architecture cleanup](architecture-cleanup/spec.md): mixed resolved and deferred tickets; older source locations and proposed designs require revalidation. This is not an automatically approved execution queue.
- [Ambient agent](ambient-agent-foundation/astra-planning-brief.md): broader foundation remains discovery only; the narrower [chat-to-note flow](archive/chat-to-note.md) is historical and its UI is retired by the Pi rebuild.
- [Settings checkpoint](settings-redesign/README.md): further design deferred.
- [Pane animation](pane-animation/validation.md#remaining-profiling): completed corrections with explicitly limited native verification and remaining profiling suggestions.
- [Workspace dock motion](workspace-dock-motion/spec.md), [Atlas research](atlas-research/report.md) and [embedding alternatives](embedding-model-alternatives/research.md): retained planning/research; verify current implementation before reuse.
- [Browser harness results](headless-browser-tests/results.md) and [earlier embedding evaluation](embeddinggemma-2-evaluation/research.md): bounded historical evidence awaiting any further use, not current acceptance gates.

## Completed work and local tools

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
