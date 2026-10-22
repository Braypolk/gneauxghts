# Adopt typed context and lazy reactive-map helpers in two small seams

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task
Priority: optional cleanup
Depends on: 04 integration if both edit the root layout

## Current behavior

`src/lib/ui/workspaceTitleSlot.ts` defines a symbol shared by the root layout's `setContext` and `PaneHeader.svelte`'s optional `getContext`. `RelatedNotesStore.acquire` explicitly checks, constructs and inserts a `RelatedResult`. Both work today. Svelte 5.57.2 provides a third presence helper in `[get, set, has]` and lazy `SvelteMap.getOrInsertComputed`. [Context API](https://svelte.dev/docs/svelte/svelte#createContext), [collection API](https://svelte.dev/docs/svelte/svelte-reactivity#SvelteMap).

## Implementation plan

1. Export one typed context tuple from `workspaceTitleSlot.ts`, retaining the `() => HTMLElement | null` value. Update root layout provision and PaneHeader consumption atomically. Use the presence helper before the getter so standalone headers still work without a provider. Do not call context helpers outside component initialization.
2. In `related/store.svelte.ts`, lazily create one `RelatedResult` per DocumentHandle with `getOrInsertComputed`, then perform the existing context update before consumer acquisition/refresh. On a newly created entry, the equal-input check remains a no-op. Preserve consumer increments, idempotent release, epoch invalidation, in-flight deduplication and disposal exactly.
3. Leave the multi-map chat coordinator and Atlas maps alone: the helper does not collapse their ownership/lifecycle requirements. Values still need their existing rune fields.

## Acceptance and ownership

Run the existing Related store tests for shared consumers, changed inputs, late responses, release/reacquire and dispose. Verify PaneHeader with and without the root provider, including reactive target replacement. Reuse current UI/compiled component checks; add a focused regression only if optional-provider behavior lacks coverage. Typecheck/build, then a focused header/Related browser journey if rendered code changes. No generic map abstraction or new persistent state.

Own `workspaceTitleSlot.ts`, the context imports/provision in `src/routes/+layout.svelte` and `PaneHeader.svelte`, plus Related store and focused tests. Root-layout edits must be integrated serially with 04. Other files can proceed independently; avoid concurrent Related/search browser verification.

## Comments

This is optional simplification, with no promised performance improvement.

Implementation outcome (2026-10-21): adopted one typed `createContext<WorkspaceTitleSlot>()` tuple, with the presence guard preserving optional standalone headers. The value remains a getter over the layout's rune, so target changes still flow to the existing slot action. Added a standalone header regression for both workspace modes. Provider/responsive behavior remains part of the combined browser verification.

Retained the existing Related insertion after a compatibility experiment: installed Svelte 5.57.2 exports `SvelteMap = globalThis.Map` under the server/default condition (`node_modules/svelte/src/reactivity/index-server.js`), while Node 24.2.0 lacks `Map.prototype.getOrInsertComputed`. Replacing insertion caused all ten existing Related tests to fail with `getOrInsertComputed is not a function`. The client implementation has the helper, but adopting it here would require a compatibility shim or changing test/server resolution for an optional cleanup. Neither improves this seam. No production Related change remains.

Focused verification: `pnpm exec vitest run src/lib/ui/PaneHeader.svelte.test.ts src/lib/features/notepad/related/store.test.ts src/lib/features/notepad/orchestration/notepadComposition.test.ts` passed all 25 tests across three files. That includes both standalone header modes and the existing ten Related lifecycle cases. Combined typecheck/build and browser verification are recorded centrally by the integrating task.
