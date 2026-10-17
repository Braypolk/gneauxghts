# Exercise multi-turn context with enabled local semantic retrieval

Status: wontfix
Type: task
Resolution: implemented

The user requested a small end-to-end pass for multi-turn context and semantic
search. Use the real native app, saved OpenAI credential and installed local
embedding provider against an owned disposable synthetic vault.

Check paraphrased retrieval, a follow-up while a similar but different note is
open, a canonical note update between turns, an explicit topic change and a
follow-up on the new topic. Verify rendered citation navigation, durable answers
after reload and the exclusion boundary. Record model calls, usage and actual
semantic embedding/ANN activity. Separate structural assertions from manual
claim review; this is a small regression pass, not a reliability benchmark.

## Comments

2026-10-10 — Added an explicitly opted-in native spec and macOS launcher. The
launcher captures the existing Keychain credential in memory for the existing
debug credential override; no credential is sent through WebDriver or persisted.
Only installed model/runtime files are copied into the disposable app.

2026-10-10 — The first complete setup reached textReady=true, four indexed notes
and a loaded ANN index. The same-query lexical/semantic toggle probe returned
two empty responses before any paid chat request. Inspection found that the
ordinary search response cache is read before semantic settings and omits both
semantic enablement and effective default ranking weights. Preserved native
failure: ../native-semantic-cache-failure.json and corresponding .log. A focused
production-command regression is being run before correcting cache identity.

2026-10-10 — Search now includes semantic enablement and effective ranking
weights in cache identity. The unchanged native toggle probe retrieves both
similar operations notes with positive semantic scores and zero lexical
matches. All 15 search-command checks and 21 architecture checks passed. The
offline regression uses the real enabled semantic state without model assets;
the default disabled TestVault cannot exercise an enablement transition.

2026-10-10 — Preserved two harness failures after correct first answers: a
synthetic navigation callback supplied a relative path instead of the absolute
editor path; a later attempt expected the composer to remain mounted after a
single-pane citation navigation returned to the editor. Corrected the path,
verified exact citation highlighting, and used production IPC for follow-ups
with an inspected real open-editor snapshot. An earlier setup was interrupted
before paid requests; later warmup exceeded the driver's 30-second script
timeout while compilation was active, so setup now allows 120 seconds.

2026-10-10 — Preserved the first two correct answers from another partial run
as native-token-oracle-failure.json. The second correctly gave QUARTZ-908 from
operations and explicitly compared AMBER-119 from the rehearsal draft. The
initial string-ban assertion rejected this valid comparison. Replaced it with
the required current token plus a cited supporting passage from operations;
manual claim review remains necessary for meaning and attribution.

2026-10-10 — The planned five-turn pass is complete. Four answers passed manual
claim review; the updated-production-note turn selected the open rehearsal
draft, reproducing an earlier wrong-source failure. The native test deliberately
remains failing on that scenario. Citation navigation, semantic participation,
topic change, new-topic follow-up and final durable reload checks completed.
See [native validation](../native-validation.md), [manual review](../native-manual-review.json)
and [issue 07](07-followup-note-referents.md). This issue's implementation covers
the harness and completed evaluation, not resolution of the new behavioral bug.


## Rebuild disposition — 2026-10-16

Superseded as an executable old-runtime ticket by [the Pi rebuild](../../archive/pi-chat-rebuild-scope.md). Retain the original evidence without interpreting its runtime-specific next steps as current work. Current chat behavior and diagnostics are covered by rebuild tickets 02–08/10; intentionally dropped implicit context, exact Retry, formatter/projection or research requirements are not restored.
