# Pi chat uncommitted-change review

Reviewed 2026-10-17/18 against `dd5292a7`, including every tracked change and
untracked source, test, documentation and research fixture. The user authorized
reviewing the full set, splitting sensible commits and committing ready work.

Independent Standards and Spec reviews covered the current architecture and the
conversation's requested editing, creation, citation and adapter cleanups. No
remaining production blocker was found. Native authority validation, the
publication state machine, exact approval, editor ownership and restart proof
remain the domain boundaries; Pi owns generic task and conversation progression.

Corrections made during this review:

- Updated simulator disclosure commands and snapshots to use the current Trace
  trigger/`aria-expanded` contract rather than native `details`/`summary` APIs.
- Repaired the LangGraph research lockfile's temporary package paths without
  changing its recorded versions or integrity hashes. Both research fixtures now
  install and reproduce their bounded results from clean temporary directories.
- Marked superseded prototype plans/tickets historical and corrected stale
  adoption descriptions and retired-source references.
- Corrected the new Settings browser test to activate the visible chat pane
  before typing into its dock. The initial full run caught an inactive, inert
  composer; two corrected focused runs passed both Settings journeys.
- Encoded a required single-space diff context line explicitly in a test fixture
  so its bytes remain identical without source trailing whitespace. All 14
  review-rendering tests pass after this correction.

The commits separate retired capabilities/compatibility, the mutation/citation
core, the chat review/controls experience and acceptance coverage, and research
plus completed-work records. Shared create/edit publication and citation changes
stay together rather than reconstructing obsolete intermediate implementations.

## Fresh verification

- `pnpm test`: 32 support tests and 1,295 tests across 151 Vitest files pass.
- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript also passes after
  the acceptance-helper corrections.
- `pnpm build`: passes; Vite retains its existing large-chunk advisory.
- Rust library tests: 641 pass, 19 intentionally ignored; architecture fitness:
  all 19 pass.
- Rebuilt isolated native E2E binary; all nine smoke files and 43 journeys pass
  with `GNEAUX_PI_PROCESS_RESTART=1`, including reviewed edits and creation across
  actual process restarts. Fixtures use generated vaults and a synthetic provider.
- Full headless browser run: 55 of 56 files passed initially. The Settings
  write-defaults interaction failure above is corrected, and both journeys pass
  on two focused reruns. All 56 files have passing coverage; the initial full
  command exited with its pre-correction failure.
- Pi research install/bundle/browser/SQLite approval-reopen passes. LangGraph
  install/static approval-reload passes and dynamic interrupts reproduce the
  documented browser context failure. These are research proofs, not production
  effect or platform guarantees.
- The six-case stock Pi edit probe also reproduces its documented synthetic
  results on the installed 1.3.0 package, including why canonical publication and
  restart reconciliation remain application responsibilities.

This pass does not establish physical-device, live-provider or new iOS simulator
acceptance. Earlier simulator outcomes retain their own documented scope. The
simulator helper correction is type-checked and independently reviewed against
the current components; it was not executed in a simulator during this review.
