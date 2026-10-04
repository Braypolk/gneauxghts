# Audit review and implementation gate

Date: 2026-10-02 (America/Denver).
Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`.

## Gate completed before source edits

All six module reports and the persistence inventory are saved. Root read each
report, traced key findings against production paths, and reconciled overlapping
evidence/Note Timeline, editor/coordination, and UI/harness recommendations.
At this point `git status` contains only `.scratch/test-suite-audit` artifacts;
no production or test files have changed.

The inventory is exhaustive by first-party source/test file; the reports openly
distinguish deep inspection from sampling. This is a complete audit deliverable,
not a claim every branch or every line has been proven correct. The six reports
are a durable pre-change record; their source line references identify baseline.

## Review decisions

- Accept architecture scan defect: independent path reproduction visited zero
  files. A virtual TypeScript probe proves both direct and literal-index access
  to removed fields already fail the required compiler check. Delete that
  redundant migration test rather than repair an extra whole-program checker.
  Keep all other ownership/routing fitness tests.
- Accept watcher fixture isolation fix before running the complete Rust suite.
  The only unisolated direct AppState constructor found in the Rust test scan
  is this case. Use disposable app/vault roots and panic-safe override teardown.
- Accept dead pane-session helper deletion and impossible orphan cleanup removal
  after whole-repository reference/assignment checks. Retain current MRU tests.
- Accept replacing the unopened-restore dummy spy with actual owner state/runtime
  assertions; dispose persistence test runtimes and restore spies; remove exact
  duplicate transient assertions and duplicate History Mode SSR setup.
- Accept one-copy TaskRecord construction and misleading duplicate task-test
  removal. Replace same-function expected outputs with literal contract cases,
  retaining dirty-task, authoritative identity and committed-warning coverage.
- Accept shared-editor transaction chaining fix with strict start-state tests.
  The production mapping was reproduced with real CodeMirror state; this is a
  small correction inside the existing owner, not an ownership rewrite.
- Add a discoverable support-test command for currently orphaned Node support
  tests and document it alongside the existing Python and build-artifact gates.

## Deliberately not bundled into this initial patch

The larger proposals are handed off in 14 numbered issues. They include composed
frontend harnesses, async store lifetimes, Unicode coordinate/navigation redesign,
explicit Rust fixture contexts, once-only task schema initialization, evidence
pagination, ChatService transaction/finalization boundaries, actual agent tool
integration, prepared-only proposal writers, semantic scheduling and strict E2E
fixture/server lifecycle. They need independently reviewable changes and their
replacement coverage; bundling them would combine unrelated persistence and UI
risks. These remain findings, not completed fixes.

Specifically, do not trim the 1,728/8,000 sequence matrices for speed: measured
test execution was small. Strengthen their legal/rejected-command oracle instead.
Do not delete independent browser/native engine checks, durability failure cases,
or genuine Markdown/evidence escaping tests. Asset overwrite reachability and
external-read/adoption ordering remain investigations rather than proven bugs.
Chat foreign-key inconsistency is real, but archived deletion explicitly enables
the pragma and is not claimed to leak rows. Performance hypotheses about full
corpus scans, repeated schema work and streaming writes are labeled unmeasured.

Independent follow-up confirmed AppStore's staged listener leak (ED-10): listeners
acquired before disposal can escape cleanup while bootstrap payload/other listeners
remain pending. Generation checks prevent stale state delivery but not resource
leaks. Add it to the async-lifetime ticket rather than generalizing a listener
framework inside this initial cleanup.

## Validation plan

Run affected Vitest tests and TypeScript/Svelte checks; run the watcher test alone
after isolation, task mutation/projection tests and then the complete default
Rust suite. Run Node/Python support checks. Run the full Vitest suite after the
combined patch. No browser/native behavior changes are planned; browser/native,
scale and live-model execution remain explicitly unverified. Compare assertions
and source changes directly; do not claim a percentage speedup from noisy cold
and warm timings.
