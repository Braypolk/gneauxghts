# Pi citation simplification — 2026-10-17

Historical checkpoint: the representation verdict below assumed compatibility
with older chats. The user subsequently waived that requirement; the
[link-only citation implementation](pi-link-only-citations.md) supersedes that verdict.
The two concrete cleanups and prototype observations remain valid evidence.

The user authorized two concrete cleanups and a single-representation prototype,
preserving actual-read guarantees and deleting further machinery only if the
experiment justified it. Publication flow remains unchanged.

## Implemented

- Native answer admission returns an array of admitted Markdown blocks. Removed
  `AdmittedAnswer.sources`, its native accumulation/deduplication and the matching
  frontend response type. No frontend consumer used the extra source array.
  Every reserved reference is still checked against native-issued receipts and
  current conversation authority before successful terminal output.
- Both ordinary and post-edit reads expose only canonical text, note/source
  identities, title, optional passage and the citation token to the model. The
  shared `noteReadOutput` projection explicitly selects these fields. Revision,
  hash and observation proof stays in native receipts and full Pi tool details.
  No persisted source schema, existing history or edit-base proof was removed.

## Prototype and decision

Primary source: local throwaway branch
`codex/pi-citation-representation-prototype`, commit
`adf0495cbf25b865be94cade34668192c87582ea`.
Its two commits contain only three added prototype files against the main parent. The working
main branch and its real index were not switched or used to capture unrelated
changes.

- `src/lib/features/chat/pi/citationRepresentation.prototype.html`: standalone,
  in-memory comparison of existing flow, token-only history and links supplied
  directly by reads. Free-play and five guided walkthroughs cover normal reads,
  compaction/reopen, fresh post-edit reads, unissued/revoked references and older
  saved chats. Open the file directly; no dependencies or connected vault.
- `src/lib/features/chat/pi/citationLifecycle.prototype.mjs`: run with Node from
  the repo root. Uses real installed Pi 1.3.0 tools, MemoryStorage, standard
  compaction and Harness close/reopen, with deterministic scripted model output.
- `src/lib/features/chat/pi/citationRepresentation.prototype.md`: question,
  observations, verdict and limits.

All three Pi lifecycle variants completed compaction and retained their citation
reference after reopening. Original tool details were absent from active context.
Thus token-only display cannot resolve labels solely from those details: it needs
an independent native lookup with pending/failure and authority-change handling.
It replaces formatting with more display orchestration rather than deleting it.

Links returned by reads are the smaller future candidate, but existing Pi tool
history contains tokens and existing answers contain links. A token decoder must
remain for that history unless we add migration. Terminal native admission, label
escaping and current-authority navigation are still required. Keeping a decoder
for compatibility is not a deletion. This experiment did not justify adding a
migration merely to remove it.

**Decision: retain the current representation and provider admission seam.** The
unused response metadata and model-facing proof were the demonstrated deletions;
neither representation replacement produces a clear additional deletion now.
Pi continues to own generation/history/compaction. Read proof, permission and
current canonical navigation remain native domain responsibilities. No new
resolver, renderer lifecycle, history migration or publication coordinator was
introduced. Older saved history is preserved as-is.

## Verification

- **252 frontend/chat tests passed**, including architecture fitness, real Pi
  tool execution, retained metadata, terminal native rejection, malformed response
  shape and standard compaction through the mandatory provider wrapper.
- **48 native Pi tests passed**, covering issued/foreign receipts, scope,
  canonical reads, passage validation, historical proof and publication protection.
- **21 native macOS journeys passed**: nine editing scenarios and twelve read/chat
  scenarios, including actual process restarts in each suite. Ordinary and fresh
  post-edit model content omit read proof while app details retain it; final
  citations still open the right current note. Exclusion and narrowed-authority
  navigation denial remain effective.
- Svelte/E2E TypeScript checks and **32 support tests passed**; no whitespace errors.

The initial combined native run passed editing but the following read suite
failed its editor-view setup. Running the read suite alone against a fresh
fixture passed all twelve scenarios. No product or harness behavior was changed
to hide that combined-run limitation. Support checks initially could not bind
localhost under the sandbox and passed with test-server binding allowed.

Reproduction commands:

```sh
pnpm exec vitest run src/lib/features/chat src/lib/architectureFitness.test.ts
cargo test --manifest-path src-tauri/Cargo.toml pi_chat:: --lib
pnpm check
pnpm test:support
pnpm test:e2e:native:build
GNEAUX_PI_PROCESS_RESTART=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/piChatEditing.spec.ts
GNEAUX_PI_PROCESS_RESTART=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/piChatNative.spec.ts
```

Selected local evidence: `/tmp/pi-citation-cleanup-acceptance/` and
`/tmp/pi-citation-prototype-observation.log`; durable fixtures and the archived
prototype are the reproducible sources.

The HTML is a model, not the native verifier or a full Markdown parser. Its script
syntax was checked; automated browser preview rejected local file URLs, so no
rendered-browser walkthrough is claimed. The real Pi probe uses scripted summaries,
not live model citation choices; its storage reopen is in-memory, not an app
process restart. Production native tests and acceptance journeys establish the
read-backed and actual process-restart guarantees separately. Admission validates
identity/location, not semantic entailment. Physical-device and live-model
behavior are not claimed by this change.
