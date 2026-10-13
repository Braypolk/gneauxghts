# Local project records

Start here to distinguish current work from development history. Tracker
conventions and retention rules are in [issue-tracker.md](../docs/agents/issue-tracker.md).
Current architecture lives in [ARCHITECTURE.md](../ARCHITECTURE.md), the
[behavior invariants](../docs/architecture/behavior-invariants.md) and [ADRs](../docs/adr/).

## Current investigations and supporting records

- [iOS readiness](mobile-ios-readiness/spec.md): prioritized implementation plan for recent iPhones; background saves, safe next-launch vault selection and drag cancellation are implemented, with device validation pending. Landscape safe areas and keyboard layout are implemented and simulator-checked. Touch editing, secondary controls and image gestures are implemented. The on-device semantic runtime is bundled and product simulator workflows pass; physical memory/workflow acceptance remains open. Mobile chat now supports both desktop providers on iOS; both protocols pass bounded simulator checks. Keychain persistence, native deadlines/network failures and shared visual proposal review are simulator-checked. Review overlap/styling/touch defects are corrected. [Container relocation](archive/mobile-ios-container-relocation.md) is corrected and verified across legacy recovery and repeated signed simulator replacement, preserving real conflicts. Physical/distribution credentials and physical/live acceptance remain in the device gate. Sync and older-device compatibility are deferred.
- [Chat reliability](chat-reliability/README.md): request latency and citation entailment are open; this index owns the next steps.
- [Context selection](chat-context-selection/spec.md): completed selection work and retained follow-ups. Follow [issue 08](chat-context-selection/issues/08-inline-citation-omission.md) for native citation omissions and [issue 09](chat-context-selection/issues/09-selection-only-answer-scope.md) for answer scope.
- Recent [instruction audit](chat-instruction-audit/spec.md), [context reduction](chat-context-reduction/spec.md) and [tool interface](chat-tool-interface/spec.md) records support those investigations. Their completed steps are measurements, not separate open implementation queues.
- [Gemma implementation](embeddinggemma-2/spec.md): the selected LiteRT implementation and remaining release-validation limits. Earlier runtime experiments in this folder describe their original checkpoints.
- [Transcript recovery](chat-transcript-recovery/spec.md): the retained implementation/recovery contract and bounded verification record.
- [Note formatting on load](note-formatting-load/issues/01-formatting-before-readiness.md): retained issue requiring fresh triage against current code.

Raw chat traces, selected source snapshots and failed runs are retained while the
citation investigation needs them. Generated evidence is local; concise findings
and reproducible fixtures belong in Git.

## Deferred or awaiting fresh triage

- [Architecture cleanup](architecture-cleanup/spec.md): mixed resolved and deferred tickets; older source locations and proposed designs require revalidation. This is not an automatically approved execution queue.
- [Ambient agent](ambient-agent-foundation/astra-planning-brief.md): discovery only.
- [Settings checkpoint](settings-redesign/README.md): further design deferred.
- [Pane animation](pane-animation/validation.md#remaining-profiling): completed corrections with explicitly limited native verification and remaining profiling suggestions.
- [Workspace dock motion](workspace-dock-motion/spec.md), [Atlas research](atlas-research/report.md) and [embedding alternatives](embedding-model-alternatives/research.md): retained planning/research; verify current implementation before reuse.
- [Browser harness results](headless-browser-tests/results.md) and [earlier embedding evaluation](embeddinggemma-2-evaluation/research.md): bounded historical evidence awaiting any further use, not current acceptance gates.

## Completed work and local tools

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
