# Phase 1–3 review fixes

Implemented against `14e29d6` following the review from baseline `428a220`. Phase 4 has not started.

## Resolution

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| A1: recovery retry can abandon a live save | Retry now acquires the existing canonical note-file mutation lock around recovery. | Real writer/retry interleavings before and after publication preserve all revisions after restart. |
| A2: completed intents retain full authored copies | Finalization and abandonment atomically clear intent payloads. Schema 10 also clears existing terminal payloads while keeping correlation metadata and pending bytes. | Repeated identical saves and abandoned large preparations stay within the production-store size bound; migration preserves foreign keys and exact, idempotent crash recovery. |
| B1: exiting during restore permits overwriting newer work | Back/Escape remain unavailable during commit and adoption. Existing route navigation waits for restore completion before flushing saves. Native pane close respects History Mode exclusion. Lifecycle notifications cannot release exclusion during commit. | Delayed publication/adoption exercise workspace exit and the actual navigation coordinator/registered departure handler. |
| B2: properties-only restore preserves old undo | Explicit undo reset passes through snapshot adoption and the existing pane/editor lifecycle, bypassing both unchanged-body shortcuts. | Real CodeMirror regression plus native properties-only restore followed by an actual Undo keystroke. Ordinary remounts retain their previous undo behavior. |
| B3: already-current restore prescribes note recovery | A typed `alreadyCurrent` command error prescribes `correctRequest` and choosing another revision. | Real command test verifies the serialized guidance and absence of an extra revision; Rust/TypeScript contract fixtures agree. |

The existing ownership architecture is retained. These are corrections to existing persistence and editor protocols; they introduce no new state owner, alternate writer, or storage layer. Behavior invariants document the corrected guarantees. Independent standards and spec follow-up reviews found no remaining actionable issues in the changes.

## Validation

- Rust: **447 tests passed**, plus **15 architecture checks**.
- Frontend: **770 tests passed** across 122 files.
- Svelte/TypeScript: **zero errors or warnings**.
- Strict Clippy across all targets/features: **passed**.
- Browser: **9 journeys passed**.
- Full native gate: **passed** both contract suites, native build, three lifecycle tests, and four timeline journeys.

The native properties-only test first failed even after the snapshot-layer fix, exposing the deeper lifecycle shortcut; it passed after the reset reached that layer.

The browser runner uses classic WebDriver because BiDi lost execution contexts during startup navigation. Existing browser helpers also wait for editor readiness and for the initial cursor restoration to settle before checking scroll persistence.

Disposable run logs and reproduction patches were removed during pre-commit cleanup; the regression tests and validation summary are retained.
