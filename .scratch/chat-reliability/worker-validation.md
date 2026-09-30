# Bounded research worker validation

Completed 2026-09-30. This milestone improves actual worker gathering and
delivery, with direct parent fallback tested separately.

## Diagnosis and changes

The initial confirmed-note baseline already gathered and delivered evidence.
The assembled worker request had all three executable evidence tools and ample
context capacity; missing tool registration did not explain the broader failure.
A later discovery run read three passages but returned an invalid non-JSON
terminal result (`artifacts/worker-final.json`). Focused instructions alone did not enforce
the selection contract.

Workers now receive a focused gathering role, tool-facing explicit dates and
scope, and metadata-only discovery hints. They inherit the original activity
range when a read omits it, reject widened ranges, and retain cursor options.
Historical query descriptions distinguish changed text from note titles.

The app-owned runtime accepts an optional result schema. Its private adapter
uses the pinned engine's result formatter alongside gathering tools, including
bounded correction of prose-only output. Owner validation still accepts only
actually read evidence IDs and closed gap codes. The formatter grants no new
action authority; context finalization removes executable tools and preserves
only the formatter. Ordinary chat keeps its existing output contract.

Counter-only diagnostics distinguish model, discovery, read and failed tool
calls, executable tools and the result formatter. Private worker prose and tool
arguments are not diagnostic fields. Empty selections preserve declared gaps
instead of inventing a no-match claim.

The first structured run delivered two historical passages, but the parent
reread them and exhausted the shared allowance before reading a related current
note (`artifacts/worker-structured-final.json`). The handoff now explicitly identifies
delivered passages as already read primary evidence. The final parent read only
the remaining historical passage, then both current notes. The related-note
assertion was retained throughout; legitimate partial worker coverage is allowed.

## Native results

The real Tauri application, production chat IPC, runtime, timeline and citation
resolution used an owned disposable synthetic vault. Every scenario selected
the same local `qwen/qwen3.8-27b` model at
`http://100.117.20.29:1234/v1`, with approved-note access and web disabled.

| Scenario | Worker outcome | Read passages | Selected | Delivered |
| --- | --- | ---: | ---: | ---: |
| Confirmed current note | ready / validated | 2 | 1 | 1 |
| Confirmed historical note | ready / validated | 1 | 1 | 1 |
| Historical discovery without confirmed IDs | partial / validated | 3 | 3 | 2 |
| Excluded scope with direct parent fallback | partial / empty_scope | 0 | 0 | 0 |
| Historical research plus independent current notes | partial / validated | 3 | 3 | 2 |

All five scenarios passed in one native test (3m 27.3s). The first three require
actual worker reads and delivered evidence; parent retrieval cannot substitute.
The fallback case performs no worker inference or reads and requires a current
parent body citation. Assembled worker requests contain three executable
evidence tools and one result formatter. All final worker tool-error counts are
zero.

The composed answer cited all three historical additions, the main current
body and the related current body. It distinguished the checked-off report,
open contract commitment and completed vendor review. It treated removed
onboarding and pilot lines as absent from current text, without treating removal
as proof of completion. The requested interval was rendered correctly. Every
admitted passage resolved through production citation services, and excluded
canary text was absent from answers.

Raw synthetic events and answers are retained locally in
`artifacts/worker-handoff-final.json` and excluded from Git; the native spec regenerates
these reports through the explicit `GNEAUX_LIVE_OUTPUT` destination.
The native debug artifact used `e2e-wdio`, dev port 1430 and driver port 4447.
SHA-256: `991596453921391c8d76805635a8fad82312f46fa61396ef8191727f83e80fc3`.

## Checks and limits

- Rust library: 681 passed, zero failed, 15 ignored.
- Architecture fitness: 19 passed.
- E2E TypeScript check: passed.
- Production runtime regressions exercise gathering, prose correction,
  structured selection and context finalization with a colliding action name
  and identical schema. Scope tests cover inheritance, narrowing, rejected
  widening, pagination and independent parent reads.
- The empty-selection regression failed with the old fabricated no-match
  outcome, then passed with the honest gap contract.

Logs are `/tmp/research-worker-library-handoff.log`,
`/tmp/research-worker-architecture-handoff.log`,
`/tmp/research-worker-types-final.log` and
`/tmp/research-worker-handoff-final.log`.

The shared 24k-character evidence allowance, 6k page bound, 12 worker tool calls
and 90-second worker limit remain unchanged. Partial delivery is explicit and
continuable. One passing fixture batch demonstrates these paths, not universal
model reliability or semantic entailment; issue 07 remains open. Driver warmup
and teardown warnings did not fail the completed native gate.
