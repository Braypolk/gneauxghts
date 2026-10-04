# Integrated validation

This records completed checks, not planned gates. All required local acceptance
checks pass. Commands ran in the shared c74a checkout; browser/native coverage
combines full inventory runs with targeted reruns after diagnosed fixes.

| Check | Observed result | Evidence |
| --- | --- | --- |
| pnpm test (final combined) |152 Vitest files,1,162 tests pass;32 Node support tests pass | validation/frontend-complete.log |
| pnpm check (final) | Svelte0 errors/0 warnings; E2E TypeScript passes | validation/check-complete.log |
| Production cargo check --offline | Pass | validation/production-complete.log |
| cargo test --offline --lib (final source, including99/99b/99c) |752 pass,16 explicitly ignored opt-ins,0 failures;112.72s | validation/rust-complete.log |
| Rust architecture fitness |23 pass | validation/architecture-final.log |
| Python fixtures, ResourceWarning elevated |8 pass | validation/python.log |
| Browser complete inventory + targeted fixes | All26 files have passing final executions; latest10-file follow-up passed60 checks, and its sole failed measurement was corrected and all8 scenarios rerun successfully | validation/browser-full-3.log; browser-rerun-1.log; browser-rerun-2.log; browser-pane-final.log; browser-final-editor-harness.log; animation-cleanup-continuity.log |
| Browser first-visible route layout | Both868px/1440px, three returns each pass after synchronous layout fix | browser-rerun-1.log |
| Browser mounted chat controls |4 pass: send/source, failed save, permission identity, model settings | browser-full-3.log |
| Browser mounted History controls |3 pass: clear confirmation, comparison/naming identity, pending restore exit | browser-full-3.log |
| Native smoke / native restart | All seven files have passing final executions: lifecycle3, timeline4, editing1, images1, pane1, chat motion1, command/event2. Restart process durability and owned cleanup also pass | native-smoke-4.log; native-remaining.log; native-command-events-final.log; native-restart-final.log |
| Support harness final |32 pass, including4 real callback lifetime checks | validation/frontend-complete.log |
| Native feature build | Passed; pinned SHA86203422a94684501cebf731b772023687e8d646c6db7c4a5ea1516b6cefbe5b | validation/native-build-final.log |

## Failures investigated rather than suppressed

- First Rust run exposed a stale source-text scanner after chat extraction. It was
  replaced by the parsed module-tree architecture check. A localhost socket test
  initially could not bind in the sandbox; its approved rerun and final combined
  suite passed.
- Browser strict dispatch exposed omitted model capabilities, pause/setup fixture
  contracts and an invented object save error. Explicit typed handlers/string
  rejection now match production; unknown commands still fail.
- Inert storage reset initially hit SvelteKit404. Owned Vite middleware now serves
  an exact reset document before app routing; tests verify its title.
- History Clear was inside a closed disclosure. The spec now opens the disclosure
  and clicks the real control, retaining cancel/confirm assertions.
- A36px first-visible route-return width shift was real. Initial Related layout
  is measured synchronously before async session/editor work; original geometry
  assertion remains.
- Shorter motion sampling exposed the editor's infinite cm-cursorLayer blink.
  The stale-animation assertion excludes only that expected infinite cursor
  animation; finite/pending pane animations must settle and other animations fail.
- Independent review found candidate kind/current-path admission occurred after
  bounded semantic/lexical retrieval. Real candidate-crowding tests reproduced
  failures and the relevant query filters now execute before limits.
- Historical retry lineage65b, cancellation joins80b, numerical99, Atlas99b and task-date99c all pass the final combined Rust suite.
- Real native startup needed sequential Vite/Tauri admission80c. Timeline/Editing Window tests needed actual diff/page/disclosure readiness80d; all original state/restore/undo assertions pass after correction.

Live-provider semantic grading, official runtime downloads, historical scale
matrices and CI execution on GitHub are separate opt-ins. Deterministic local
checks do not claim that evidence. No source was pushed/deployed or committed.

## Late boundary acceptance

- New rendered typography and true offscreen task navigation pass. The latter
  reproduced a real detached cursor-restoration loop overwriting the requested
  scroll; awaiting its completion before releasing the pane operation fixes it.
  Independent review confirms bounded completion and unchanged focus/ownership.
- Latest10-spec browser run:60tests pass; the one retarget assertion conflated
  elapsed frame progress with discontinuity. A controlled probe reproduced68.3px
  movement over33ms while replacement origin differed by0.00025px. The revised
  oracle asserts origin continuity within1px and actual intermediate paint.
  All8 animation-cleanup scenarios pass in animation-cleanup-continuity.log;
  no production animation change or relaxed continuity threshold was needed.
- Native command/event2checks pass real save/task provenance and staged-vault
  delivery through AppStore. Restoring a previously nonexistent macOS temp path
  requires the canonical returned receipt because /var resolves to /private/var;
  the test now asserts realpath and exact event/store receipt equality.
- Native restart recovered pending endpoint and anchor in a new process, rejected
  writes after the portability-ready receipt, then cleanly closed again. Vite's
  esbuild-stop diagnostics occur during owned teardown after both app exits; the
  runner completed successfully. Evidence directory is printed in its log.

## Final acceptance

All required local gates passed after review fixes. Historical failed runs remain
for diagnosis and are superseded by the specific passing runs listed above. The
16 Rust ignored tests and one sustained native measurement skipped by smoke are
explicit opt-ins, not hidden failures. Provider quality, external pinned runtime
archive installation, historical release-scale matrices and GitHub CI execution
remain outside the deterministic local acceptance claims.
