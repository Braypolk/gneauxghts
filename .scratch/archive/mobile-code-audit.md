# Mobile thread code audit

Date: 2026-10-11
Status: completed

## Scope and method

Reviewed the working tree against `c9b8a990` (`git diff HEAD`), including new
production files, test fixtures, build scripts and supporting records. The
[iOS readiness plan](../mobile-ios-readiness/spec.md) and subsequent user decisions
define the scope: recent iPhones, desktop feature coverage, local semantic
workflows, desktop-equivalent remote chat, simulator validation, and deferred
sync/physical-device acceptance.

Independent Standards and Spec passes checked the frontend and native changes;
the integration review checked their actual callers and lifecycle boundaries.
Standards sources were `AGENTS.md`, `ARCHITECTURE.md`, behavior invariants and the
app-owned runtime ADR, plus the code-review skill's duplication, coupling,
naming, ownership and speculative-abstraction heuristics.

## Confirmed findings, corrected

1. **P2, Spec/build correctness:** the iOS framework staging script used
   `hashlib.file_digest`, unavailable in the stock Python 3.9.6 interpreter that
   can satisfy the wrapper's plain `python3` invocation. Replaced it with bounded
   streaming SHA-256 updates. System Python now verifies the pinned official ZIP,
   rejects different bytes, and stages the full framework successfully.
2. **P2, Standards/correctness:** touch external-link actions owned an independent
   body popup outside `PaneTransientUiController`. Keyboard activation of a
   retained pane could leave the origin's actions visible over its collapsed
   frame. The popup is now a keyed Svelte component, opened through existing
   per-view callbacks and represented in the canonical transient state. Pane
   collapse, editor retirement, History, note options and competing editor menus
   close it. The editor retains only range validity and actions; document,
   selection, configuration and lifetime changes invalidate stale actions.
   Positioning and body mounting reuse `floatingPanel` and `mountInSlot`.

Both corrections received a focused independent review. The mounted keyboard
pane-switch regression passes, alongside existing Open/Edit, modifier-click,
Escape, outside-tap, route-exit and authored-text preservation checks.

## Assessment

No further confirmed Standards or Spec defects remain in the reviewed scope.
The changes generally reuse the existing header, dock, composer, model picker,
date picker, proposal review, image viewer and persistence/runtime boundaries.
Viewport listeners and queued work restore/clean up on teardown; gestures cancel
and release captures; signed runtime packaging preserves the build/app boundary;
relocation keeps one transactional write path and explicit proposal approval.

Small touch-target CSS rules remain local to their components. A general sizing
abstraction would couple unrelated layouts without removing demonstrated logic
duplication. Similar gesture/session lifetime guards encode different validity
rules and do not justify a generic controller.

One potential profiling follow-up is update-proposal identity resolution:
`resolve_note_path_by_id` enumerates Markdown files until it finds the target.
No measured latency defect was established. A future optimization should use a
verified catalog fast path with stale/moved-note fallback, preserving canonical
identity checks; this audit does not replace it with an unverified cached path.

## Validation

- Full frontend suite after corrections: **1,213 tests, 152 files passed**, plus
  **33 test-harness checks**.
- Rust library suite: **870 passed**, 27 opt-in tests ignored.
- Architecture fitness suite: **21 passed**.
- Mounted touch editing: **8 passed**; retained pane rails: **19 passed**;
  secondary touch controls/image gestures: **7 passed** (**34 total**).
- `pnpm check`: zero errors and warnings, including E2E TypeScript.
- System Python 3.9.6: official ZIP checksum accepted, nonmatching bytes rejected,
  full runtime staging passed.
- `git diff --check`: passed.
- Final signed arm64 simulator build and strict recursive signature verification:
  passed. Installed over the existing simulator app without resetting its data.
  Startup visibly restored the existing synthetic note and its accepted content.

Physical iPhone memory/performance, distribution provisioning and live-provider
acceptance remain in the existing device gate. This audit used local provider
fixtures and did not make paid/live API calls. Simulator/browser checks cannot
establish physical-device release readiness.

## Probe cleanup, 2026-10-12

Removed both superseded probe trees: isolated semantic embedding tooling and the
cancelled on-device chat experiment. This pruned 10 files, including 2,208 lines
of experiment source/data and a 60-line reproduction README. Historical pins,
measurements, findings and limits remain in the research/validation records;
their obsolete reproduction links and integration to-do list were reconciled.

Removed 82 temporary entries totaling approximately 9.17 GiB by `du` allocation:
cancelled chat weights and source downloads, isolated app builds, probe caches,
raw semantic outputs, superseded product package copies and earlier audit app
backups. Kept the verified official runtime ZIP used by normal iOS builds, the
current signed app package, and selected small remote-chat validation records.
The retained 250-line remote-chat protocol fixture supports regression and device
validation; product source, automated tests and simulator app data were unchanged.

Validation: local Markdown links in 24 mobile/index records pass; no references
to removed probe files remain. The remote fixture's CLI loads, the retained ZIP
passes its production checksum verifier under system Python, the current app's
strict recursive signature verification passes, and diff whitespace is clean.
No app behavior changed, so application suites were not rerun for this cleanup.
