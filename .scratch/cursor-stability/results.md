# Cursor test harness correction

Completed 2026-10-03 (America/Denver). The retained change is confined to
`e2e/specs/browser/editor-cursor.spec.ts`. No production cursor code changed.

## Change

- Require exact authored Markdown after real paste, replacing readiness based on
  a substring common to the previous fixture.
- Set geometry cursors once through the existing editor selection capability and
  assert exact authored selection and focus before measuring.
- Map wrapped samples to authored positions, excluding noneditable widget text;
  resolve DOM Range endpoints across split text nodes. Expected geometry still
  comes independently from DOM Range, never production cursor coordinates.
- Create native ranges with real Shift+Arrow input, asserting browser and model
  selection agree. Retain actual pointer placement, typing, keyboard collapse,
  blur, wrapped-row coverage, and all existing geometry tolerances.

All 12 scenarios remain. The file shrinks from 324 to 300 lines relative to the
saved turn-start source. No timeout increases, test retries, skips, or polling
that reapplies selection were added. Diagnostic specs were removed from the live
E2E discovery directory and preserved here as evidence.

## Verification

- Focused cursor run: 12/12 passed, 5.7 seconds of tests, 7 seconds total
  (`cursor-after.log`).
- Full default headless browser run: 110/110 cases across 26/26 files, 2m42s,
  exit 0 (`browser-final.log`). One existing dates WebDriver intercepted-click
  diagnostic recovered within that passing scenario; favicon 404s also remain.
- `pnpm check:e2e`: passed (`types-final.log`).
- Scoped `git diff --check`: passed.
- Independent source review: no actionable defect or weakened coverage
  (`review.md`). No duplicate test/build execution by the reviewer.

## Evidence and limits

The fixture control demonstrated that the old substring predicate accepts the
previous wrapped document while the new exact predicate correctly rejects it;
actual paste then admits the intended document (`fixture-control.log`).

Controlled native/model selection experiments showed an immediate asynchronous
mismatch that converged after rendering. Neither focus refresh nor a no-op view
update established sustained selection loss. Hidden-tab frame suspension and a
headless popup did not reproduce the historical cursor failure. See `findings.md`
and the preserved diagnostic sources/logs for positive and negative results.

The fragile test setup is corrected, but the original uninstrumented headed
selection timeout's exact cause remains unproven. Passing these runs must not be
reported as proof of a production cursor defect or universal flake elimination.
Native macOS WebKit was not run because it opens foreground windows; the real
Shift+Arrow contract is therefore verified here only on headless Chromium.

No merge, commit, staging, or push performed. Prior unrelated workspace changes
were preserved. Earlier source manifests are historical; this follow-up supersedes
their cursor-spec hash only.

Final cursor source SHA-256: `f428d56600568ab4ea91dc2e9ba9218a5ce0d8be05b4a9ab4e5d1e9a790bccdc`.
