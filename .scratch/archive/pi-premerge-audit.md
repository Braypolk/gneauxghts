# Pi pre-merge audit — 2026-10-16

The later [combined cleanup verification](pi-combined-merge-readiness.md)
supersedes this validation snapshot and records additional UX/test corrections.

No remaining blocking Standards or Spec finding was identified within the agreed
rebuild scope after the corrections and acceptance below. The checkout is ready
for final manual UI review and commit preparation; this is not a blanket release
or physical-device acceptance verdict.

## Scope

Reviewed the effective checkout on `codex/pi-durable-native-prototype`, including
untracked rebuild files, against local `main` at
`160085d6f6c619189ce5d2faadef987915d94bff`. Branch HEAD was
`64cc3ff656f05d18d4e25ef3fea7695b07cbafb1`; much of the rebuild remains
uncommitted. Tracked-only Git diff statistics omit the new implementation.

Fetched origin for comparison: remote `main` was
`c9b8a99033de9ac6a4b01b8afd6ba369f418da50`, an ancestor of local `main` by
11 commits. No remote-only main commits required integration at audit time.
No commit, merge or push was performed.

Standards and Spec inspections ran independently, followed by verified corrections.
Sources included AGENTS, ARCHITECTURE, behavior invariants, ADR 0012, the agreed
rebuild scope and six adapter-alignment tickets, and the subsequent composer,
Forget, citation, attachment-removal and Stop requirements.

## Corrected findings

| Finding | Correction and evidence |
| --- | --- |
| P2: Native close could emit its only quiesce request before the frontend installed its listener. A pending request then timed out even after startup completed. | Redeliver the same pending token every 250 ms while awaiting acknowledgement. Admission still closes only after acknowledgement; no second close generation is invented. New native regression installs the listener after the first request; storage tests pass. |
| P2: Generic Pi scheduler retry/task/compaction details bypassed sanitized runtime diagnostics. Arbitrary exception text could reach chat. | Fixed safe lifecycle messages preserve New attempt and Pi execution ownership. A real Pi task canary test confirms raw private detail is absent from rendered output. Native tool-result errors remain visible. |
| P2: The default native smoke lane listed deterministic Pi specs whose opt-in guards skipped every scenario. | Deterministic suites now run by default, with adapters included. Only live inference and explicit process-reopen cases retain opt-ins. Generated-vault admission remains mandatory. |
| P3: An excluded note missing from the current index could render with an empty title. | Use its Note Identity as the fallback label; indexed notes retain their actual title. |

Native acceptance also contained stale select/attachment/send expectations after
the authorized UI cleanup. Tests now use the actual Full vault / No notes menu,
assert empty-scope read denial and use Queue while Stop occupies the primary
button. Background editor activation delivers the existing pane pointer/focus
events before reading its owner snapshot. Exact canonical-body, revision,
dirty-input, held-acknowledgement and receipt-replay assertions are retained.

## Cleanup

- Removed 25 unreferenced AI Elements components and 319 lines of obsolete chat
  CSS, plus the unused scroll scheduler and composer reset API/tests.
- Removed the redundant exclusion mutation IPC and unused native compatibility
  getters, constructor state, proof accessor, index helper and test helper.
- Simplified the same-path note-update publication path: durable proof recording
  is mandatory, and the unused move branch and optional bypass are gone.
- Inlined publication wrappers that merely forwarded calls. Retained the native
  permission, canonical-base, exact approval, editor ownership and commit-proof
  boundaries; these enforce domain guarantees that Pi does not supply.
- Removed the empty application compaction policy. Harness now inherits Pi
  defaults directly; `modelLimits.ts` only translates observed model metadata.
- Guarded simulator acceptance entry/cleanup with development mode, corrected
  retired-runtime README claims and settings wording, and formatted Rust sources.

Authored-code inventory including untracked files: application-source files fell
from 541 to 464, roughly 160k to 135k lines against local main. Test/support files
fell from 301 to 273, roughly 65k to 52k lines. Inline Rust tests count with their
source modules; lockfiles, docs, generated files and assets are excluded. These
are size observations, not performance or maintainability proofs.

## Validation

| Check | Result |
| --- | --- |
| `pnpm check` and final E2E TypeScript check | Passed; zero Svelte errors/warnings |
| `pnpm test` | 1,169 tests / 145 files passed; 32 Node support tests passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 712 unit tests and 24 integration tests passed; 19 existing ignored tests |
| `pnpm test:timeline:fixture:checks` | 16 passed |
| `cargo fmt --check`, `git diff --check` | Passed |
| Ordinary `pnpm build` | Passed; no native/browser/simulator acceptance bridge or canary markers in output |
| Browser chat controls, chat dock/scroll, history citations, workspace input dock, mobile viewport | 36 tests / 5 files passed |
| Native publication with `GNEAUX_PI_PROCESS_RESTART=1` | 6 passed, including real process reopen |
| Native chat with `GNEAUX_PI_PROCESS_RESTART=1` | 11 passed, including real process reopen |
| Native adapter diagnostics | 2 passed |
| Native standard compaction | 2 passed; actual threshold compaction/continuation and Stop joining background summary |
| Native live local-model streaming/read/citation | 2 passed with the configured Qwen local model; text/reasoning observed in Pi and rendered UI before completion; successful native search/read and citation navigation |

Native files run in separate invocations through `runNativeSpecs`, against their
generated vaults. An initial direct multi-file invocation was interrupted after
exposing stale tests; it is not counted as acceptance. Subsequent isolated runs
resolved the stale UI/activation/label checks. Embedded-driver and reconnect
warnings are not represented as successful checks by themselves; scenario and
suite assertions determine the recorded results.

An additional focused live citation run passed after tightening the assertion to
require the ordinary note destination with no History Mode fallback, matching the
user's subsequent citation correction.
Physical iOS, foreground gesture/paint lanes and live hosted credentials were not
retested. No total-storage, IPC, latency or semantic-entailment win is inferred.

## Before merging and later follow-up

- Confirm the intentional new-user scope in the merge description: clean chat
  reset, no legacy migration, initial read-only model tools, future create/update
  authority foundation, and review by default. Removed legacy features are an
  agreed product change, not accidental parity.
- Keep a final manual local-model UX pass for composer appearance, citations,
  Stop/Queue, Forget/undo and reopening history. Automated DOM checks do not
  establish every foreground pointer, keyboard or paint behavior.
- Do not block this agreed desktop scope on physical iOS or live hosted credentials.
  Neither was freshly exercised by this audit; prior simulator evidence remains
  bounded and is recorded in the rebuild/adapter outcomes.
- The shared search/hash extraction was subsequently authorized and completed;
  see [the cleanup outcome](pi-shared-search-cleanup.md) for the replacement owners,
  removed legacy code and fresh validation.
- Make fresh matched measurements before claiming lower storage, IPC or latency.
  Pi retains durable history and needs native domain adapters; source reduction
  alone proves none of those resource improvements.
- Include the new untracked implementation/tests/docs when preparing the commit.
  Recheck origin immediately before the eventual merge/push.
- Prefer a squash merge or similarly coherent final change: the branch currently
  has 94 commits after local main, much of which records now-retired experiments.
  If squashing and later deleting the experimental branch, retain a historical
  checkpoint ref for `64cc3ff6`; archived evidence links rely on that Git history.
