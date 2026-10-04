# Main integration verification

Progress: Validation complete; integration approved for local main fast-forward.

## Included work

Cleanup baseline was cb4d4c02. Main advanced through Atlas Fusion to 3464e93b.
The user explicitly authorized including all eleven then-uncommitted date-feature
files; those were saved on main as 754c2a03. Cleanup was preserved in c5af2cfb,
then Atlas integrated in b0dced8b. The final integration includes both histories,
all intentional new sources/configuration/history fixtures, and audit reports.
Generated Python caches, scratch logs, patches and diagnostic copies remain local;
none were staged into source. No push is requested or performed.

## New-test review and corrections

- Kept cleanup's joined Atlas initialization, single lifetime/search admission,
  shared browser fixture contract, owned event listeners and strict unsupported
  command failures. Folded the duplicate initialization regression into its
  stronger existing case and strengthened the existing query row to old/new/old.
  Retained removed-selection/failed-refresh recovery as distinct coverage.
- Kept all twelve public map journeys, including the one 2,000-node mounted case.
  Reused the inert workspace reset and typed Atlas snapshot/publication helpers;
  moved map motion coverage out of the editor navigation file. Preserved the
  actual offscreen editor-route regression. Removed obsolete Deck instrumentation,
  its unused import bridge and both unused direct Deck dependencies.
- Strengthened double-click handoff so clicked, selected and preexisting editor
  note cannot be confused. The first revision targeted a dot covered by the
  floating reader; a hit-test diagnostic proved the occlusion. The final case
  establishes Beta through real workspace navigation, selects Beta on the map,
  then double-clicks visible Alpha and requires Alpha in the editor. No synthetic
  click, timeout increase, product behavior change or diagnostic assertion remains.
- Replaced the layout test's implementation-derived containment oracle with
  independent rectangle bounds; kept spacing, determinism and cache contracts.
- Preserved the shared command-view fixture and cross-language task-date rows.
  The new native typing, nested annotation, calendar Apply and undo cases cover
  different boundaries; they were retained. Browser fixture/outcome assertions
  now wait for exact saved bodies and popup disappearance. Updated both affected
  Rust mutation expectations for editable authored `due` wording.
- Ported main's optional opening-activity payload and complete compatibility/decay
  regression into the extracted Atlas publication owner rather than restoring
  the old monolithic module. The lab keeps its explicit command override seam
  with main's fresh read-only data behavior and relocated demo fixture.
- Applied rustfmt to the existing cleanup formatting discrepancies exposed by
  the final format check. This is formatting only beyond the reviewed changes.

Reviews were recorded before edits in atlas-test-review.md, date-test-review.md,
spec-review.md and integration-findings.md; review.md records final Spec checks.
Independent reviewers reported no remaining confirmed production findings in
these scopes. Source hashes cover 1,077 non-scratch files and were checked for
unrelated drift after validation.

## Validation

| Check | Result |
| --- | --- |
| Full frontend | 1,075 cases in 144 files passed |
| Harness/support | 32 passed |
| Rust default test command | 726 library passed, 16 intentional opt-ins ignored; 21 architecture passed; binary/doc targets passed |
| Python fixture checks with ResourceWarning elevated | 8 passed |
| Svelte/TypeScript/E2E | Passed, zero Svelte errors/warnings; E2E types passed again after final map correction |
| Frontend production build | Passed |
| Normal non-test Rust build | Passed |
| Rust formatting and diff whitespace | Passed |
| Focused corrected Atlas browser suite | 12/12 passed |
| Final browser case coverage | 119/119 cases across all 26 files passed across the full run plus two targeted session-start checks |

The browser result is deliberately **not** reported as a clean single invocation:

1. Initial combined run passed 25/26 files; the strengthened map test attempted
   an occluded dot. Corrected fixture navigation is explained above.
2. The next complete run passed Atlas but the host slept for fifteen minutes
   during startup-readiness; its timeout/closed transport aligns with power logs.
3. An unchanged run with command-scoped sleep prevention passed 110 cases in
   24 files, including startup-readiness. selection-menu and settings failed to
   create WebDriver sessions before their tests ran (opaque POST /session errors).
4. Both files then ran unchanged with driver logging: all nine cases passed in
   eleven seconds. These plus the 24 files cover all 119 current browser cases.
   No retry setting or test timeout was changed. Two owned orphan ChromeDriver
   processes from failed creation were identified by exact PIDs/ports and stopped.

The unclassified driver-admission failures are recorded separately in
issues/01-browser-session-startup.md. These are not demonstrated application
failures and were not concealed by deleting tests or weakening assertions.
Existing recovered date-click diagnostics and favicon 404s remain in browser logs.

All browser work was headless. Native WebKit was not rerun; earlier native smoke
is historical evidence, not validation of these new renderer/date changes.
Remote CI and non-macOS runtime behavior were not exercised. The old uninstrumented
cursor timeout remains unproven as documented in ../cursor-stability/results.md.
No timing here is offered as a controlled performance comparison.

Local evidence files include check.log, frontend.log, rust.log, build.log,
rust-build.log, python.log, browser.log, map-hit-diagnostic.log, map-after.log,
browser-final.log, power-events.log, browser-awake.log and browser-session-check.log.
They remain in the integration worktree rather than adding raw logs to Git.
