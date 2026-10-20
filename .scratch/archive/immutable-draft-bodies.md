# Immutable draft bodies and eager string consumers

Completed 2026-10-20 against main `fd9c0ad1`, after the visible-range formatting,
image-inventory, headless-root parser and Markdown recognizer fixes. The user
requested a fresh assessment of the remaining draft boundary and implementation
if warranted. Earlier investigation lives in
[live Markdown snapshots](../../docs/research/gneauxghts-markdown-snapshots.md).

## Assessment and implementation

The earlier fixes removed full-document presentation traversal, ordinary-edit cold
image reparses and redundant root parsing. They did not remove the runtime's
full-string application callback. Reproducing the diagnostic on current main
still found one `Text.toString()` per content-changing dispatch, about 0.8 ms for
the runtime/draft path at two million multiline characters. An acquired Related
entry also compared two full-body JSON keys on each update. The immutable body
migration therefore remained warranted, with a smaller direct benefit than the
previous image-inventory correction.

- `DocumentBody` retains immutable CodeMirror `Text`, exact content equality,
  cached non-whitespace detection and a lazily cached Markdown snapshot. It is a
  value, not a new mutable document owner. Weak equality-cache keys do not retain
  an additional history of body versions.
- `NoteDraftState.working` and saved/external baselines use bodies. Ordinary editor
  transactions synchronously deliver a body through the existing editing service.
  Loaded bodies seed both the saved baseline and the headless history root;
  unchanged committed bodies and captured save baselines retain shared text.
- Save capture pins the body, metadata, identity and operation token/revision.
  Persistence checks cleanliness before requesting Markdown and serializes that
  exact capture at the existing native save boundary. Newer edits, conflict and
  publication admission, task retries, history resets and retained-chat ownership
  retain their existing coordination.
- Related invalidation compares body identity, path and title. Only retrieval
  requests Markdown. Two panes updating the same body do not repeat full-text
  JSON construction. Content equality, not body identity or revision alone,
  determines clean/no-op behavior, including undo to the baseline.
- Native Markdown payloads/files and Note Timeline policy are unchanged. Exact
  CRLF/CR boundary strings survive until editing, while root construction and
  replacements use the same normalized editor text as pane construction. Review
  caught and corrected the initial root/pane offset mismatch for those inputs.

## Matched isolated measurements

The pre-change [snapshot probe](../../docs/research/diagnostics/markdown-snapshots.probe.ts)
was run before edits. The current
[body probe](../../docs/research/diagnostics/draft-bodies.probe.ts) retains the same
multiline fixtures, real runtime/editing service, state-backed pane stand-ins,
dirty checks and operations, with the new body callback and loaded-body sharing.
Each series uses four warmups and 21 timed samples. Source views use real editor
transactions; formatting plugins, Svelte effects, DOM/layout, IPC and actual
save/search timers are excluded. These are **not rendered typing latency**.

Times below are median / p95 milliseconds for insertions. The retained
[results JSON](../../docs/research/diagnostics/draft-bodies-results.json) also
contains same-length replacements near the end, selections and image-field
dispatches. Lower medians at larger sizes reflect warmup/JIT and sharing; they
are not a claim that larger notes are faster.

| Characters | Panes | Before | After |
| --- | --- | --- | --- |
| 50,000 | 1 | 0.0313 / 0.0580 | 0.0203 / 0.0597 |
| 50,000 | 2 | 0.0328 / 0.0392 | 0.0209 / 0.0298 |
| 500,000 | 1 | 0.2115 / 0.2413 | 0.0285 / 0.0330 |
| 500,000 | 2 | 0.2468 / 1.2746 | 0.0185 / 0.0285 |
| 2,000,000 | 1 | 0.8015 / 0.9775 | 0.0128 / 0.0220 |
| 2,000,000 | 2 | 0.8140 / 1.1803 | 0.0169 / 0.0240 |

Each insertion/replacement series still sends 25 content notifications; string
conversions fall from 25 to **zero**. Selection-only dispatches have zero callbacks
and conversions. The ordinary image-free `imageState` path also has zero string
conversions after migration. Ten explicit reads of one edited runtime snapshot
perform one conversion, reused by the shared model body.

Size-dependent work still exists. A two-million-character single line with
same-length edits near its end measured 0.601 ms median / 5.188 ms p95; a giant
whitespace line with a final non-whitespace edit measured 1.487 / 3.416 ms.
Both had zero conversions, but exact equality and whitespace detection can scan
large chunks. No allocation/memory profile was collected. Subsequent
[native app before/after measurements](draft-body-app-benchmark/README.md)
find about 3 ms lower input-to-frame medians for two-million-character prose
in split panes, with little change for smaller notes/code fences and persistent
giant-quote backlog. Those app measurements are separate from this isolated probe.

## String-consumer audit

| Consumer | Decision |
| --- | --- |
| Runtime change notification, document admission/dirty checks, forgotten-marker and pane-command emptiness checks | Use immutable body/equality/whitespace operations; no eager snapshot. |
| Related reactive context updates | Body identity plus metadata; serialize only when retrieval actually runs. |
| Autosave and background/departure saves | Clean check first; capture immutable version before awaiting, then request one cached string at IPC. |
| Current-note/all-note search | Retain the existing 120 ms debounce and no-query early return. String/hash work occurs for actual requests. |
| Wikilink suggestions and navigation | Explicit draft-aware requests require Markdown and the existing fingerprint protocol. No unconditional closed-menu snapshot. |
| Task preparation | Capture a body, serialize for hashing/native preparation, then compare the exact body and operation/identity after awaits; retry behavior preserved. |
| Conflict rollback/copy, host snapshots, Forgotten-Note Recovery and navigation/mount | Explicit snapshots/replacements retain strings at their operation boundaries. Retained headless documents own bodies independently of editor lifetime. |
| Chat | Continues to retain document identity/routing without implicit per-edit body input. |
| Image inventory | Existing optimization remains: image-free edits avoid strings; image-containing notes still serialize/extract using complete incremental parse results. No additional inventory redesign here. |
| Block commands, quote location and code-context fallback | Operation-specific full-body work remains. No parser or command redesign in this migration. |

Search/Related/wikilink fingerprints retain their native content-hash semantics;
they are not replaced with an ephemeral frontend revision. Caching those hashes
or further improving image-containing extraction is separate from eliminating
unconditional edit-time snapshots. Remaining Markdown parser delays stay parked
under the existing investigation.

## Validation

New tests cover zero-conversion draft updates, independent split-pane selection
and scroll, shared undo/redo and exact clean/no-op behavior; save capture before
later edits and serialization after an await; later-edit preservation after save
adoption; headless session snapshots after editor retirement; unchanged-save
short-circuiting; Related refresh and metadata/body invalidation; exact Unicode,
whitespace and CRLF/CR round trips; production pane normalization on initial edit,
ordinary/history-reset replacement and committed adoption.

Independent Standards and Spec reviews found the line-ending divergence, verified
its correction, and reported no remaining actionable findings. The full frontend
test suite passed with 1,382 tests (one skipped); all 125 support tests passed.
Type checks reported zero errors/warnings, and the production build passed.
All 35 mounted browser regressions passed, covering background saving,
inline/reference images in split panes, History return/Version Restore, and
Related lifetime/presentation. The 12 saving/image/history cases were rerun after
the line-ending correction. Initial validation did not include native/iOS;
the follow-up above supplies native app measurements. iOS remains untested.

## Reproduction

From the repository root, using the installed lockfile dependencies:

```sh
cp docs/research/diagnostics/draft-bodies.probe.ts src/lib/features/notepad/editor/draftBodiesDiagnostic.temporary.test.ts
pnpm exec vitest run src/lib/features/notepad/editor/draftBodiesDiagnostic.temporary.test.ts
rm src/lib/features/notepad/editor/draftBodiesDiagnostic.temporary.test.ts
```

The pre-migration probe targets `fd9c0ad1` and its earlier string callback. Run
it at that revision for the baseline; it is historical source, not a current
callback consumer. Temporary production-tree diagnostic copies were removed.
