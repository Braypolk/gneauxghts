# Excerpt-only answer scope

Implemented and verified on 2026-10-14. Resolves
[context selection issue 09](../chat-context-selection/issues/09-selection-only-answer-scope.md).

## Cause and correction

Explicit selected context supplied readable text with a legacy note source, but
no exact passage answer-read selector. The ordinary direct read retrieved the
whole note. Existing source guidance additionally required complete canonical
content before calling a detail unrecorded, without an excerpt-only exception.

Explicit selections and validated adjacent-editor selections now expose a
run-local cursor for their exact canonical body range. The ordinary `read_notes`
answer branch admits those passages under its existing permission, canonical
freshness, evidence allowance and citation checks. Registration alone creates no
passage citation or whole-note read coverage. Pagination and recovery stay inside
the selection, including when its initial context text was clipped. Explicit
line starts disambiguate repeated text; ambiguous editor text, including
overlapping occurrences, receives no guessed selector.

Selection context and existing source guidance distinguish excerpt-only intent
from ordinary questions. The latter can still read the permitted whole note or
related evidence. There is no question parser, implicit permission lock, new
tool, extra formatter call or enlargement of the shared assistant core.

## Verification

The regression through real context assembly and the registered `read_notes`
tool failed before the fix because the selection had no answer-read selector.
It passes after correction. Six focused regressions cover exact citations and
the unrestricted read, clipped UTF-8 pagination, repeated/overlapping text,
adjacent-editor selections, clipped editor hints, and stale/excluded evidence.

The native app used production `chat_send_message`, tool definitions, runtime,
terminal storage and passage resolution with a disposable synthetic vault and
lexical retrieval. Configured local model: `qwen3.8-27b-gsq-rco` at
`http://100.117.20.29:1234/v1`, preserving its reasoning default. No paid calls,
real-note writes or real-app preference changes. The fresh pinned E2E binary is
SHA-256 `8a423c5bff0777cb89994d9871c58d29ed68e18fdcfb887160fe25af5d3327f9`.

| Native case | Delivered result | Citation |
| --- | --- | --- |
| Original excerpt-only question | Cannot determine whether the rest of the note names an approver; explicitly preserves that uncertainty | Exact selected sentence only |
| Unrestricted companion | Correctly names Jordan and quotes “Jordan approved deployment.” | Actual canonical body containing that statement |
| Editor-hint selection only | The highlighted text names no approver and only records a discussion | Exact selected sentence only |

All three sources resolve, and canonical fixture bytes remain unchanged.
The retained local artifact is
`.scratch/chat-reliability/artifacts/excerpt-scope-2026-10-14/native.json`.
This bounded local-model acceptance is not a same-provider comparison against
the older hosted failure, or a general semantic-entailment success rate.

Repository checks: 922 Rust library tests, 21 architecture checks, one runtime
lifetime test, 1,242 frontend tests, 38 Node support tests, and 16 Python fixture
checks pass. Svelte/TypeScript/E2E checks pass with zero errors or warnings.
The sandboxed Rust and Node attempts could not bind their localhost fixtures;
their complete runs outside the sandbox pass. All four background native smoke
files pass (14 cases); the existing foreground-only cursor-paint assertion is
skipped in that lane.

The complete headless browser gate finishes with 48 of 50 files passing. Two
unchanged `secondary-touch.spec.ts` cases fail in proposal review: one expects
obsolete Keep/Undo buttons in the chat card, and the editor-review fixture does
not implement the required `chat_get_proposal_draft` command. The current card
offers Discard/Review in editor. No frontend or browser-fixture code changed in
this fix; native proposal review passes. These need separate fixture upkeep.
The other failing file is `workspace-input-dock.spec.ts`: its glyph-motion
assertion exceeds a 48.52-pixel threshold with 48.859375 pixels. That exact case
passes an unchanged isolated rerun (1/1); this does not erase the full-gate
failure. No unrelated UI or test correction was made during issue 09; the
subsequent authorized proposal-fixture correction is recorded below.

Logs are `/tmp/gneaux-excerpt-scope-{rust,frontend,check,fixture,browser,native-build,native-live,native-smoke,dock-rerun}.log`.
`git diff --check` passes.

## Proposal-fixture follow-up — 2026-10-15

The two `secondary-touch.spec.ts` failures are resolved. The chat-card test uses
the current Discard/Review in editor actions. Its creation fixture supplies a
valid destination and draft; the update fixture supplies versioned draft reads
and checkpoints and removes dismissed proposals from pending results.

After restoring the current selectors, the original touch-target assertion
exposed a real regression: the new chat-card actions were only 28 pixels tall.
`ChatProposalRegion.svelte` now gives its buttons a 44-pixel minimum width and
height on coarse-pointer devices. Existing layering, hit-testing and review
styling checks remain, and both cases additionally verify canonical fixture
notes stay unchanged. Undo restores the exact original editor body.

All seven cases in the secondary-touch browser file pass. The focused chat,
proposal controller, coordinator and orchestration unit suites pass, as do
Svelte and TypeScript/E2E checks with zero errors or warnings. The initial
two-case run reproduced the 28-pixel failure before the CSS correction.

The subsequent requested full browser rerun passes all 50 files in 11 minutes
21 seconds, including secondary-touch and all 26 workspace-input-dock cases.
Command: `pnpm test:e2e:browser`; exit status 0. Its log is
`/tmp/gneaux-browser-full-rerun.log`. The earlier full-gate failure and isolated
dock-motion rerun remain historical evidence above.

Logs: `/tmp/gneaux-proposal-fixture-{focused,browser,check,unit}.log`.

## Commit-audit corrections — 2026-10-15

The first Standards/Spec audit found two boundary failures missed by the initial
regressions. The selected-context resolver dropped leading empty lines while
retaining their original line start, causing exact-range registration to fail.
Fixed-size selection chunks could also contain only whitespace, which canonical
candidate creation incorrectly rejected as stale.

New selections preserve their leading newlines. Older stored selections can
recover only the immediately leading empty-line prefix within their recorded
line range; recovery never searches for a different occurrence. Exact-position
canonical candidates retain whitespace-only chunks after byte validation, while
unpositioned whitespace discovery and wholly whitespace selections remain
invalid.

Three additional regressions first failed on the expected causes and now pass:
the real selected-context resolver through production prompt assembly, older
stored selections with repeated text and insufficient-range rejection, and
byte-for-byte delivery of a selection containing a whitespace-only chunk through
both explicit context and editor hints. Independent Standards and Spec follow-up
audits report no remaining actionable findings. These deterministic corrections
do not add provider calls or change the browser/UI paths; the earlier native
acceptance and full browser rerun remain the validation recorded above.

Red/green logs: `/tmp/gneaux-blockers-{blank,legacy,whitespace}-red.log`,
`/tmp/gneaux-blockers-{blank,whitespace}-green.log`.

Final correction validation: the complete Rust run passes 925 library tests
(31 existing ignored), 21 architecture checks and one runtime-lifetime test,
with zero failures. Log: `/tmp/gneaux-blockers-rust-full.log`; command
`cargo test --manifest-path src-tauri/Cargo.toml`, exit status 0.
`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and
`git diff --check` pass. No frontend or browser files changed after the recorded
50-file browser pass. Both audit blockers are closed.

## Reproduce the live acceptance

Build with `node e2e/support/buildNative.mjs`, then run:

```sh
GNEAUX_CITATION_NATIVE=1 \
GNEAUX_CITATION_NATIVE_SETTINGS='{"provider":"local","model":"qwen3.8-27b-gsq-rco","reasoning_effort":"medium"}' \
GNEAUX_CITATION_NATIVE_CASES='["partial-selected","partial-unrestricted","partial-hint-only"]' \
GNEAUX_LIVE_ENDPOINT=http://100.117.20.29:1234/v1 \
GNEAUX_LIVE_MODEL=qwen3.8-27b-gsq-rco \
GNEAUX_LIVE_OUTPUT="$PWD/.scratch/chat-reliability/artifacts/excerpt-scope-FRESH/native.json" \
pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/citation-reliability.spec.ts
```

Use a fresh artifact destination. The live spec retains the existing bounded
provider/tool/token/time checks and preserves final answers on failure.
