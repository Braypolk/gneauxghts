# History hardening plan

Completed and audited 2026-09-06: the three simplifications, native acceptance, actual interrupted-process recovery, large current-format histories, and bounded old-citation navigation. Use one fresh implementation agent per issue, sequentially, with an orchestrator audit before starting the next issue. Existing uncommitted work for issues 36–43 is the baseline; do not revert it or delete user databases.

| Order | Work | Result |
| --- | --- | --- |
| [44](issues/44-remove-duplicate-window-policy-model.md) | Remove the duplicate Editing Window policy model. | Complete; independently audited |
| [45](issues/45-preserve-typed-history-errors.md) | Preserve typed history errors without diagnostic rescans. | Complete; independently audited |
| [46](issues/46-bind-concrete-selected-vault-context.md) | Bind history work to a concrete selected-vault context. | Complete; independently audited |
| [47](issues/47-complete-pending-native-acceptance.md) | Complete the two pending native acceptance checks. | Complete; independently audited |
| [48](issues/48-test-interrupted-process-relaunch.md) | Test interrupted process recovery and actual relaunch. | Complete; independently audited |
| [49](issues/49-validate-current-format-large-histories.md) | Validate current-format 10k and 100k retained histories. | Complete; independently audited |
| [50](issues/50-navigate-old-citations-with-bounded-context.md) | Navigate directly to old citations with bounded context. | Complete; independently audited |

The accepted [capture contract](../../docs/architecture/editing-window-contract.md), mandatory history preparation, and committed-result warning behavior remain authoritative. Concrete private vault/store context is sufficient; no generic store interface or multi-vault feature is planned. Each ticket records its focused checks and evidence. Native display unavailability must be recorded explicitly without claiming completion or substituting hidden measurements.

Issues 22 and 24–26 remain deferred and outside this effort. Historical release measurements remain historical evidence. Issue 47 completed issue 43’s two pending visible native gates; driver reconnection does not establish process restart. Do not commit until requested.


Final evidence: issue 47's [native acceptance](issues/47-complete-pending-native-acceptance.md),
issue 48's [interrupted-process recovery](issues/48-test-interrupted-process-relaunch.md),
issue 49's [current-format large-history validation](../../docs/architecture/current-format-large-history-49-validation.md),
and issue 50's [bounded citation validation](../../docs/architecture/citation-context-50-validation.md).
All issues 44–50 passed orchestrator review with independent Standards and Spec
audits. No commit was created. Issues 22 and 24–26 remain deferred and unchanged.
