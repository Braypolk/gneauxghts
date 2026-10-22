# Upgraded-package capability implementation

All ready items assigned to this chat are implemented or have completed their
bounded no-change experiment, 2026-10-21 local time. Combined verification
completed with the explicit skips and limits recorded below.
The [original plan](../package-capabilities/spec.md) records scope and ownership.
Image delivery is owned by the separate image chat; its production changes and
staged image hunks were preserved. The coordinated shared native-suite edit only
registers the new connection spec and remains outside that staged image change.

## Implemented

- Native provider DNS/timeout/connection classification, fixed safe model-list
  failures, existing Pi retry/cancellation behavior, and stale Settings result
  suppression. Optional metadata remains nonfatal.
- Benchmark capture/comparison commands using saved Vitest results, complete
  portable evidence, compatibility checks and no-overwrite paths. No speed gate.
- Safe synchronous Kit client-error presentation with curated status/copy and
  selectable local references. No raw exception content or recovery actions.
- Typed optional workspace title context, one conditional mock pilot and three
  task-date lazy-regex replacements. Related insertion stays unchanged because
  the helper is unavailable in the supported Node test/server environment.
- Existing component inspector documented as an explicit development opt-in.

The nine implemented execution tickets are historical records outside the active
backlog: [01 connection](package-capabilities-2026-10-21/tickets/01-connection-errors.md),
[02 benchmarks](package-capabilities-2026-10-21/tickets/02-benchmark-comparisons.md),
[03 inspector](package-capabilities-2026-10-21/tickets/03-component-inspector.md),
[04 client errors](package-capabilities-2026-10-21/tickets/04-render-error-recovery.md),
[06 search experiment](package-capabilities-2026-10-21/tickets/06-query-centered-excerpts.md),
[07 doctor](package-capabilities-2026-10-21/tickets/07-vitest-doctor.md),
[08 Svelte helpers](package-capabilities-2026-10-21/tickets/08-svelte-helpers.md),
[10 conditional mocks](package-capabilities-2026-10-21/tickets/10-conditional-mocks.md)
and [11 regex](package-capabilities-2026-10-21/tickets/11-lazy-regex.md).
Separately owned [image delivery](../package-capabilities/issues/05-native-image-delivery.md)
and [watcher-health triage](../package-capabilities/issues/09-watcher-diagnostics.md)
remain active, along with the newly observed
[inspector activation limits](../package-capabilities/issues/12-inspector-native-activation.md). Original plans and chronological comments
in archived tickets are context, not renewed implementation instructions.

## Experiments

[Benchmark validation](../../docs/research/editor-benchmark-comparisons-2026-10-21.md)
passed one capture and three comparisons of six workloads. Variation on the same
candidate illustrates measurement noise; this is no application speedup claim.

[Search comparison](../../docs/research/search-excerpt-experiment-2026-10-21.md)
retains the current production preview. Distributed-term scoring is useful, but
Tantivy's effective UTF-8 budget shortens Unicode context and fails the adoption
gate. It changes neither search authority nor ranking.

[Vitest doctor](../../docs/research/vitest-doctor-2026-10-21.md) completed in an
exclusive window. It recommended keeping the current isolated threads setup:
5.91 s versus 7.73 s with five workers, a 31% regression. Disabling isolation
failed. Production configuration remains unchanged; normal and seeded-shuffle
isolated full suites passed with fixed source hashes.

## Validation

Completed: combined type/E2E checks (zero errors/warnings), 139 support tests,
and normal plus file-order-shuffled frontend suites (seed `20261021`): each
passed all 164 files, 1,416 tests and one unchanged skip. The skip is
`markdownPerformance.test.ts`'s `measures pure decoration rebuilds` case.

Focused acceptance also completed: Settings browser tests (17), real Kit
render-error browser regressions (3), frontend connection/diagnostic tests (36),
client-error unit/render tests (10), helper/Related/composition tests (25),
benchmark contract tests (9, included in support), and native classifier tests
(5). Focused counts overlap the full suites and are not additional totals.
Ordinary benchmarks passed two files/six workloads, followed by one capture
and three saved-baseline comparisons, each with six complete passed artifacts.
The search experiment completed 16 displayed fixtures and ten real owner
observations; its offline comparison was inspected in a disposable WDIO session.

The coordinated [image implementation report](../../docs/research/tauri-async-images-2026-10-21.md)
records the combined Rust graph: 658 unit tests passed, 19 ignored, 19
architecture tests, four lifecycle-exclusion tests and one runtime-lifetime
integration test; documentation tests contained no cases. It also
records 16 Python fixture checks and the combined disposable native smoke:
11 specs, 47 passes and four existing opt-in/platform skips. These results do
not establish the separate foreground, injected-fault or production-preview
acceptance below.

## Native and production acceptance

The combined debug native E2E binary was rebuilt after implementation and pinned
with SHA-256 `1a77d5c31112b40792162a6852d477c73c497a6e82f298a00101e8dc533f13cf`.
It uses `e2e-wdio`, the separate E2E bundle identifier and disposable
app-data/documents/vault/Keychain namespace. Focus stayed in the default background
lane except the user's explicitly authorized brief inspector check.

- Fresh complete combined background smoke passed all 12 specs: 50 tests,
  zero failures and four unchanged `GNEAUX_PI_PROCESS_RESTART` opt-in skips.
  The skips cover separate-process composer restoration, temporary authority,
  pending edit review and pending creation. This background run does not claim
  that restart lane. Log: `/tmp/gneauxghts-capabilities-native-smoke.log`.
- The maintained native connection spec passed all three cases: real IPC
  401/429/503, malformed/empty catalog, passive Settings, refused connection,
  five-second timeout and explicit refresh recovery, cancellation and subsequent
  Pi generation. Its first run found a test envelope collision with the driver's
  reserved `error` field; a tagged outcome preserves exact backend assertions
  without protocol wrapping. It joins the background smoke registry.
- Four native WebKit error checks passed: initial failure at measured 1200 CSS px,
  update failure and expected 404 at measured 417 px, then a real dirty-workspace
  failure while Pi was active. Safe copy, stable/read-only selectable summary,
  no overflow and no fallback recovery controls passed. The existing Pi task
  settled with stop reason `stop`; provider requests remained one. The workspace
  unmounted and its bridge was released. Dirty text happened to reach canonical
  storage in this run; this is no draft durability or recovery guarantee. The
  root navigation remains outside this boundary.
- The dirty-workspace fault used a temporary page overlay only. Exact original
  bytes were restored in finally and checked against SHA-256
  `b89bff9a37d7da3cc257b547921da89c26668909676967061f10115606ba6de4`.
  No shipped fault trigger, extra route or recovery action remains.
- Production build passed with inspector opt-in deliberately present. Exact
  runtime/overlay/opener patterns were absent from emitted assets. Actual
  production frontend native preview passed ordinary DOM editing and absence of
  inspector DOM/resources. The initial background `browser.keys` attempt did
  not deliver editable input; the repository's established DOM `insertText`
  path passed. This does not claim OS input latency or hardware key delivery.
- Ordinary development HTML/Vite client with inspector/E2E variables unset and
  ordinary native E2E DOM/resources had no inspector injection.
- Inspector browser stack/gesture checks passed; the authorized native check
  preserved editor text/selection, resolved PaneHeader53 → NotepadPane214 →
  Notepad1550 → page25, exited with Escape and restored DOM editing/menu behavior.
  Native WebKit received complete DOM modifier/hover events because the embedded
  driver omits special-key modifier flags and mouseover transitions. Physical
  native OS chord delivery remains unverified. Source opening requested
  `src/lib/ui/PaneHeader.svelte:53:3`, but the local editor launcher failed. A
  visible native toggle click did not stay enabled. These limits are documented
  in the [workflow](../../docs/development/component-inspector.md) and a
  [triage follow-up](../package-capabilities/issues/12-inspector-native-activation.md).
- Fresh maintained deterministic agent replay passed one case. The new
  `pnpm test:client-errors` CI command passed its three real Kit browser cases.
  The native presentation/registry contracts passed three focused tests after
  adding the connection spec. These overlap earlier totals.

Selected screenshots were inspected. Owned native apps, driver sessions and
fixture servers closed after each completed check. Ignored evidence lives under
`.scratch/package-capabilities/evidence/` and WDIO named-session artifacts; raw
logs use `/tmp/gneauxghts-capabilities-*.log`.

## Integration result

The fresh full maintained browser run passed all 65 specs: 384 tests, zero
failures and 40 unchanged opt-in performance/profiling skips. Those skips are
18 full-app Markdown measurements, two paragraph probes, 18 mounted Markdown
measurements and two quote profiles; they do not introduce functional exclusions.
The coordinated image chat owned the run and closed its server/browser.
Log: `/tmp/gneauxghts-image-browser-final.log` (14m04s).

Fresh final combined `pnpm check` also passed with zero errors/warnings,
including E2E TypeScript: `/tmp/gneauxghts-image-check-final.log`. Together with
50 native passes/12 specs, frontend/unit/support/Rust results, production build,
agent replay and focused native/browser fault checks above, this completes the
selected integration gates. No new maintained test skip was introduced.
Performance claims remain limited to the separate controlled experiments.

Initial scoped reviews reported no actionable correctness/spec/standards issue.
The subsequent cohesion audit found a stale Settings capability-editor callback;
the correction and regression evidence are recorded below. Scoped relative file links and whitespace checks
pass. Temporary fault source was restored, named sessions closed, and owned native
apps/driver/fixture servers were cleaned up. Image production/index ownership and
pre-existing editor upgrade changes were preserved.

## Cohesion audit follow-up

The audit reproduced one lifecycle defect: a successful local model capability
request settling after its component unmounted became an error, which the retained
Settings parent displayed after switching to OpenAI. The editor now checks its
captured endpoint/generation and mounted lifetime before adopting either success
or failure, and avoids starting a retired editor continuation.

Two maintained browser regressions hold capability IPC, switch provider through
the real keyboard controls, and settle the retired request with success or
failure. Both fail against the unfixed callback and pass with the correction.
The complete Settings spec passes 19 cases. The follow-up also passes type/E2E
checks with zero errors/warnings, 139 support tests, and the full combined
frontend graph (1,418 passes and one existing skip). Counts include the separate
image chat's two new unit tests; those image changes remain separately owned.
The production build and all three maintained Kit client-error browser checks
also pass. Both capability regressions pass again after exact restoration of the
fixed source following the intentionally failing run. No native code changed in
this correction; the earlier native acceptance above was not rerun.
Follow-up logs use `/tmp/gneauxghts-settings-retirement-*.log`.

## Boundaries

Watcher health remains a design/triage task. Root-shell containment and safe
unsaved-state recovery require a separate ownership/settlement design. The
pre-existing native pane content-width mismatch was still separately tracked at
this point; passing smoke checks did not establish that the entire measurement
lane passed. Its [later resolution](native-pane-motion-admission.md) corrects a
pre-admission assertion error and verifies the unchanged native motion journey.
The initial implementation turn did not request a commit. The user subsequently
authorized committing the capability changes after this audit correction and its
verification; unrelated editor upgrades and the other chat's image work remain
outside that commit.
