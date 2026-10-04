# Coordinator second-pass assessment

Progress: bounded inspection complete; no source edits proposed. Independent cross-layer reports supplement this decision.

## Scope

Revisited completed first-pass rejection maps and sampled remaining common/helpers, settings render states, shared History failure normalization and chat rendering. Read actual implementation alongside candidate cases. This is a targeted follow-up using the previous broad audit, not a claim that every remaining assertion has been proved indispensable.

## Findings

- HistorySettingsPanel healthy/error/reset cases share setup but distinguish different messages, recovery availability and persisted reset diagnostics. Browser settings tests exercise healthy clear/purge actions, not every broken-history presentation. Removing this layer would drop useful cheap coverage.
- SemanticSettingsPanel tests distinguish queued work from running indexing, model errors from index errors, unsupported platforms, missing runtime/files and recovery/resume paths. The common SSR helper already avoids fixture duplication. Mounted Settings tests do not prove all these branches.
- ChatMarkdown tests separate actual code/prose markup from streaming accessibility state. EvidenceSource tests separate literal untrusted excerpt rendering, historical removal with uncertain clocks, and baseline knowledge without an invented introduction date. These are different rendering/privacy contracts, not duplicate strings.
- listSelection's wrapping, disabled skipping, missing current selection, input modality and rejected pointer targets are separate behaviors in a small fixture. Removing individually cheap examples does not simplify application boundaries or test scaffolding.
- modifierHints preserves both exact delayed reveal and short-press cancellation; mounted modifier-hold tests are not equivalent to fake-clock cancellation.
- History failure normalization's constructor/toString/__proto__ examples could theoretically be represented by one prototype-property sample, and numeric/null unknown states hit the same type guard. Such cuts would save only input values while removing explicit adversarial examples. No meaningful maintenance reduction justifies trimming that small table here.
- Settings search empty/whitespace/punctuation inputs converge after normalization but enter through different input normalization examples. Further table trimming saves essentially no source/scaffolding and would optimize the displayed count rather than the user's complexity problem.
- chatPanelHelpers has a trivial stable context-key example among actual anchor, preview-shape and URL admission tests. Deleting that one cheap check would leave the same file/fixture with negligible maintenance benefit; no whole-layer replacement established.

## Measurement interpretation

The last full frontend run reported1,065 cases,4.38s aggregate test-body time and19.39s wall time, with transform/collection work and concurrent typechecking. Those timing categories overlap across workers and must not be added or subtracted as a serial profile. They nevertheless do not support a claim that deleting a few tiny assertions will materially improve the workflow. Rust library runtime was114.53s; this inspection did not profile which remaining durable/IO fixtures dominate it. Runtime optimization would need focused profiling rather than indiscriminate case deletion.

## Recommendation

Stop broad deletion after the completed97-case/1,835-line reduction unless another exact overlap is demonstrated. No new code/test edits or tests run in this follow-up. Further worthwhile work is likely in fixture/setup and import coupling or another concrete simplification of production behavior, rather than lowering the test count itself. Do not imply that all remaining tests are necessary forever or that current reports establish perfect coverage.
