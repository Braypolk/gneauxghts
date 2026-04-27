# Slowness Research

**Date:** 2026-04-26
**Goal:** Identify architectural anti-patterns, high Big O complexity, deeply nested logic, and other performance bottlenecks that make editor interactions feel slow.
**Scope:** Editor component and all related/imported modules.

---

## Search Checkpoints

Use these as recovery anchors if context is lost mid-research:

- [ ] Editor core (`editor.ts`, `editorLifecycleController.ts`, `draftlyPlugins.ts`)
- [ ] Block types, cursor state, slash menu
- [ ] Image handling (embed parser, widgets, paste)
- [ ] Wikilink runtime and state
- [ ] Note store and runtime store (Svelte state management)
- [ ] Search and related notes stores
- [ ] Navigation and open flow
- [ ] Orchestration (refresh, persistence, proposal, pane session)
- [ ] Keyboard shortcuts
- [ ] Auto-sync
- [ ] Graph view (layout, prep, map store)
- [ ] Settings store and refresh coordinator
- [ ] AI review diff
- [ ] Tauri backend: index, lexical, search commands, wikilink commands, note session, note persistence

---

## Findings

### 🔴 CRITICAL: `build_current_override` Called on Every Interactive Command

**Files:** `src-tauri/src/index.rs`, `src-tauri/src/commands/wikilink_commands.rs`, `src-tauri/src/commands/search_commands.rs`

Every single Tauri command that involves the editor (`resolve_note_link`, `autocomplete_note_links`, `search_notes`, `search_notes_hybrid`, `get_related_notes`) calls `build_current_override(current_path, current_title, current_markdown)` which:
1. Parses the **entire markdown body** into paragraphs via `build_paragraphs()` — O(n) where n = body length
2. Parses the **entire markdown body** into tasks via `build_tasks()` — O(n)
3. Both call `markdown.replace("\r\n", "\n")` creating a full string copy

This means **every keystroke** that triggers a wikilink autocomplete, search, or related notes call re-parses the full document on the Rust side. For a 50KB document, this happens synchronously on the command thread.

**Impact:** Every interactive operation (wikilink autocomplete, search) re-parses the full document body just to build an in-memory `IndexedNote`. This is the single largest contributor to perceived lag.

**Recommendation:** Cache the current override and invalidate only on explicit note open/save. Or pass a pre-computed structure from the frontend instead of raw markdown strings.

---

### 🔴 CRITICAL: Full Document Re-parse in `build_tasks` with O(n²) Line Matching

**File:** `src-tauri/src/index.rs`

The `build_tasks()` function calls `file_line_to_editor_line_1based()` for **every single task line**. This function:
1. Does `normalized.lines().collect::<Vec<_>>()` — creates a full vector of all lines
2. Then does `(0..=target_idx).filter(...).count()` — linear scan up to target
3. Then does another full body parse: `note::extract_file_name_title_and_body(&normalized, "").1`
4. Then iterates body lines again with `body.lines().enumerate()`

For a document with T tasks and L lines, this is **O(T × L)**. For a document with 100 tasks and 500 lines, that's 50,000 iterations of string comparison.

**Impact:** Every time `build_current_override` is called (see above), task building becomes quadratic.

**Recommendation:** Pre-compute the line offset mapping once during body extraction. Cache the result.

---

### 🔴 CRITICAL: Svelte 5 `$state` Re-creates Entire Objects on Every Update

**File:** `src/lib/features/notepad/state/noteStore.ts`

The note store uses `$state` with a deeply nested object containing `notes` (Map), `unsavedNotes` (Map), `activeNoteId`, etc. Every call to `setNoteUnsaved`, `setNoteSaved`, `setActiveNote`, etc. creates a **new object** with spread operators (`{ ...state, ... }`). Svelte 5's fine-grained reactivity helps, but the deep nesting means:
- Any component subscribing to derived values that access nested properties will re-compute
- The `notes` Map is replaced entirely on every note operation (new Map created)

**Impact:** Heavy re-computation cascade through any component that reads from the store.

---

### 🟠 HIGH: CodeMirror ViewPlugin Runs Full Decoration Rebuild on Every Update

**Files:** `src/lib/features/notepad/editor/editor.ts`, `src/lib/features/notepad/editor/draftlyPlugins.ts`, `src/lib/features/notepad/editor/cursorState.ts`

Multiple `ViewPlugin` instances with `update` callbacks that run on every editor change:
- `wikilinkDecorationsPlugin` — scans document for wikilinks
- `imageEmbedDecorationsPlugin` — scans document for image embeds
- `cursorStatePlugin` — tracks cursor position
- `blockTypePlugin` — determines block types

While CodeMirror's `ViewUpdate` provides changed ranges, the wikilink and image decoration plugins may still scan large portions of the document. The `draftlyPlugins.ts` block rendering is particularly expensive as it creates DOM decorations for every block.

**Impact:** On every keystroke, multiple plugins re-scan and re-decorate the document.

**Recommendation:** Use CodeMirror's `changedRanges` to incrementally update decorations. Consider debouncing non-critical decorations.

---

### 🟠 HIGH: `ensure_interactive_index` Holds Two Locks Simultaneously

**File:** `src-tauri/src/index.rs`

```rust
let mut index = self.notes_index.lock().map_err(...)?;
let mut invalidation = self.interactive_invalidation.lock().map_err(...)?;
```

This acquires `notes_index` lock first, then `interactive_invalidation` lock. If any other code path acquires them in reverse order, deadlock. More importantly, while holding both locks, it may call `index.refresh(notes_dir)` which:
1. Recursively walks the filesystem (`collect_markdown_files_recursively`)
2. Reads file metadata for every `.md` file
3. Reads full file contents for changed files

This blocks ALL other commands that need either lock during the refresh.

**Impact:** During startup or after file system changes, every interactive command blocks on a full filesystem scan.

---

### 🟠 HIGH: Search Commands Pass Full Document Content Over IPC

**Files:** `src-tauri/src/commands/search_commands.rs`, `src-tauri/src/commands/wikilink_commands.rs`

Every search and wikilink command accepts `current_title: String` and `current_markdown: String` as parameters. For a 50KB document, this means **50KB+ of data is serialized and sent over Tauri IPC on every keystroke** that triggers autocomplete or search.

**Impact:** IPC serialization/deserialization overhead for large documents compounds with the re-parsing issue (#1).

**Recommendation:** Pass a document hash/ETag instead. Only send full content when the hash differs from the server's cached version.

---

### 🟠 HIGH: `merge_hybrid_candidates` Creates HashMap with String Keys

**File:** `src-tauri/src/commands/search_commands.rs`

The hybrid search merge uses `HashMap<String, HybridCandidate>` with keys like `"path::section::match_text"`. For every lexical and semantic candidate, string formatting and hashing occurs. With 100s of candidates, this adds up.

**Impact:** Moderate overhead on every hybrid search, which fires on every search input.

---

### 🟡 MEDIUM: Auto-Sync Fires on Multiple Overlapping Timers

**Files:** `src/lib/sync/autoSync.ts`, `src/lib/features/notepad/orchestration/persistenceController.ts`, `src/lib/features/settings/store.ts`

Multiple sources schedule auto-sync:
- `persistenceController` schedules after every save
- `settings/store` schedules on vault note changes
- `handleVisibilityChange` triggers sync on tab visibility
- Various other event handlers

While deduplication exists (`cancelScheduledAutoSync` before rescheduling), the frequent re-scheduling means the sync timer is constantly being reset, potentially delaying actual syncs.

**Impact:** Sync operations may be delayed or fire more frequently than necessary.

---

### 🟡 MEDIUM: Settings Store Polls Semantic Status Every 5 Seconds

**File:** `src/lib/features/settings/store.ts`

```rust
semanticPollTimer = window.setInterval(() => { loadSemanticStatus() }, 5000);
```

This fires a Tauri `invoke` every 5 seconds while settings are visible and indexing is in progress. Each invoke crosses the IPC boundary.

**Impact:** Continuous IPC traffic while settings tab is open.

---

### 🟡 MEDIUM: `file_line_to_editor_line_1based` Does Triple Pass Over Document

**File:** `src-tauri/src/index.rs`

This function is called for every task during indexing and:
1. First pass: `normalized.lines().collect::<Vec<_>>()` — collect all lines
2. Second pass: `(0..=target_idx).filter(...).count()` — count occurrences
3. Third pass: `body.lines().enumerate()` — find matching line in body

**Impact:** O(n) per task, making task building O(n × tasks).

---

### 🟡 MEDIUM: `normalize_search_text` Called Repeatedly in Hot Paths

**Files:** `src-tauri/src/index.rs`, `src-tauri/src/commands/wikilink_commands.rs`, `src-tauri/src/commands/search_commands.rs`

`normalize_search_text` (which calls `collapse_whitespace` + `to_lowercase`) is called many times per operation:
- In `note_matches_reference` for every note in the index
- In `build_note_suggestions` for every note
- In `structural_boost` for every search result

While each call is O(n) for the string length, the cumulative effect across 100s of notes is significant.

**Impact:** Repeated string normalization across large note collections.

---

### 🟡 MEDIUM: `build_paragraphs` Creates Intermediate Strings

**File:** `src-tauri/src/index.rs`

```rust
for line in body.replace("\r\n", "\n").lines() {
    // ...
    current_lines.push(line.trim().to_string());
}
```

This creates a new string for the normalized body, then creates new strings for each trimmed line, then joins them again in `finalize_paragraph`.

**Impact:** Excessive memory allocation during document parsing.

---

### 🟢 LOW: `reviewDiff.ts` LCS Algorithm is O(m×n) with Full DP Table

**File:** `src/lib/features/inbox/reviewDiff.ts`

The diff algorithm uses a full DP table `Uint32Array[oldLines.length + 1][newLines.length + 1]`. For two 1000-line documents, this is a 1M entry table (4MB). This only runs during AI review, so impact is limited.

**Impact:** Only affects AI change review flow, not editing.

---

### 🟢 LOW: Graph Layout Uses Force-Directed Simulation

**Files:** `src/lib/features/graph/graphLayout.ts`, `src/lib/features/graph/graphPrep.ts`

Force-directed graph layout is inherently O(n²) for n nodes. For large vaults (500+ notes), this can be slow.

**Impact:** Only affects graph view rendering, not editing.

---

## Architecture Summary

### Key Bottleneck Chain (What Makes Typing Feel Slow)

```
Keystroke
  → CodeMirror ViewUpdate (all plugins re-run)
    → wikilinkDecorationsPlugin (scans document)
    → imageEmbedDecorationsPlugin (scans document)
    → blockTypePlugin (re-evaluates blocks)
  → If wikilink being typed:
    → Tauri invoke `autocomplete_note_links`
      → IPC serialization of full current_markdown (50KB+)
      → Rust receives call
      → build_current_override() re-parses full markdown
        → build_paragraphs() O(n)
        → build_tasks() O(n × tasks) [QUADRATIC]
      → ensure_interactive_index() may trigger full filesystem scan
      → iterate all notes for matching
      → IPC response back to frontend
      → CodeMirror updates completion UI
```

### 🔴 CRITICAL: `handleEditorMarkdownChange` Triple-Fires on Every Keystroke

**File:** `src/lib/features/notepad/Notepad.svelte` (line ~474)

```typescript
function handleEditorMarkdownChange(paneId, document, nextMarkdown, editorState) {
  // ... state updates ...
  scheduleAutosave(document);
  scheduleSearch();
  scheduleRelated();
}
```

Every keystroke in the editor triggers **three separate scheduled operations**:
1. `scheduleAutosave(document)` — eventually calls `saveNoteSession` → Tauri `invoke('save_note')` → full Rust-side document parse
2. `scheduleSearch()` — eventually calls `search_notes_hybrid` → Tauri IPC with full markdown → Rust re-parse + semantic embedding
3. `scheduleRelated()` — eventually calls `get_related_notes` → Tauri IPC with full markdown → Rust re-parse + semantic embedding

All three send the **full `current_markdown` string** over IPC (see #3). So a single keystroke can trigger up to 3 IPC round-trips, each carrying 50KB+ of document content.

**Impact:** This is the primary reason typing feels sluggish — every keystroke spawns a fan-out of async operations that each re-parse the full document on the Rust side.

**Recommendation:**
- Debounce search and related notes more aggressively (e.g., 500ms instead of whatever current debounce is)
- Share a single `build_current_override` cache between all three operations
- Consider sending a document hash instead of full content (see #3)

### 🟠 HIGH: `openNotePath` Blocks on `flushAllPendingDocumentSyncs`

**File:** `src/lib/features/notepad/Notepad.svelte` (line ~769)

```typescript
async function openNotePath(notePath, options) {
  flushAllPendingDocumentSyncs();
  flushAllPendingCursorSaves();
  // ... async operations ...
}
```

`flushAllPendingDocumentSyncs` iterates over **all notes in the store** and calls `flushDocumentEditorSync` for each. This walks every `NoteDraftState`, checks pane associations, and potentially triggers editor content replacement. This runs **synchronously** before any async work begins.

**Impact:** Note navigation feels janky because the main thread blocks on syncing all pending document state before the async open can even start.

**Recommendation:** Move the flush to a microtask or `requestAnimationFrame` so the async open can start immediately.

### 🟠 HIGH: Multiple `$derived.by` Chains Create Reactive Pressure

**File:** `src/lib/features/notepad/Notepad.svelte`

Several `$derived.by` computations form chains:
```typescript
let currentProposalChanges = $derived.by(() => getProposalChangesForPath($activeProposalSession, documentSession.currentNotePath));
let currentProposalUpdate = $derived.by(() => getCurrentProposalUpdate(currentProposalChanges));
let currentProposalPreview = $derived.by(() => buildProposalPreview(currentProposalUpdate));
let hasCurrentProposalReview = $derived(currentProposalChanges.length > 0);
let isCurrentNoteUnderProposal = $derived(hasCurrentProposalReview);
```

This chain re-computes whenever `$activeProposalSession` or `documentSession.currentNotePath` changes. The `isDocumentUnderProposal(document)` function is then called in **template expressions** for each pane, meaning every render of `Notepad.svelte` re-evaluates this chain.

**Impact:** On every note change or proposal session update, the entire chain re-computes, potentially triggering re-renders of both `NotepadPane` instances.

### 🟠 HIGH: `attachPaneSelectionTracking` Attaches Global `selectionchange` Listener

**File:** `src/lib/features/notepad/Notepad.svelte` (line ~1680)

```typescript
function attachPaneSelectionTracking(paneId, isEditorReady, editorRoot) {
  // ...
  document.addEventListener('selectionchange', handleSelectionChange);
}
```

This fires a `$effect` for each pane, and each effect attaches a **global** `document.addEventListener('selectionchange', ...)` listener. `selectionchange` fires on every text selection change in the entire document, including during normal typing and mouse drag.

**Impact:** On every selection change, `updateSelectedRelatedText(paneId)` is called, which may trigger DOM queries and related text updates.

**Recommendation:** Throttle the selectionchange handler or scope it to the editor root only.

### 🟠 HIGH: `Notepad.svelte` is 2586 Lines — Massive Single Component

**File:** `src/lib/features/notepad/Notepad.svelte`

The entire component is ~2600 lines of script + template + styles. This means:
- Svelte's compiler must process the entire component on every change
- The reactive graph for this single component is enormous
- Any state change in this component potentially triggers re-evaluation of all `$derived` and `$effect` blocks
- The template has multiple complex `{#if}` blocks that re-evaluate on every render

**Impact:** Svelte 5's fine-grained reactivity helps, but the sheer size means more work per render cycle. Splitting into smaller components would isolate reactive scopes.

### Primary Recommendations (Priority Order)

1. **Cache `build_current_override` result** on the Rust side with invalidation on note open/save. This eliminates the full re-parse on every command.
2. **Fix `build_tasks` quadratic complexity** by pre-computing line offset mapping once.
3. **Pass document hash instead of full content** over IPC, only sending full markdown when hash changes.
4. **Incremental decoration updates** in CodeMirror plugins using `changedRanges`.
5. **Reduce lock contention** in `ensure_interactive_index` by separating dirty path processing from full refresh.

### Secondary Recommendations

6. Deduplicate `normalize_search_text` calls by pre-computing normalized forms in the index.
7. Reduce memory allocations in `build_paragraphs` by using string slices where possible.
8. Debounce non-critical auto-sync triggers.

---

## Complexity Analysis Table

| Operation | Current Complexity | Notes |
|-----------|-------------------|-------|
| `build_current_override` | O(n) per call | n = document length, called on every command |
| `build_tasks` | O(n × T) | T = task count, nested in `build_current_override` |
| `file_line_to_editor_line_1based` | O(n) per call | Called T times inside `build_tasks` |
| `autocomplete_note_links` | O(N) | N = note count, iterates all notes |
| `ensure_interactive_index` (full refresh) | O(N × n) | Reads all N notes, parses each |
| `merge_hybrid_candidates` | O(L + S) | L = lexical results, S = semantic results |
| Wikilink decoration plugin | O(n) per update | Scans full document |
| Image decoration plugin | O(n) per update | Scans full document |
| `normalize_search_text` | O(s) per call | s = string length, called many times |
| AI review diff | O(m × n) | m, n = line counts of old/new docs |
| Graph layout | O(V²) | V = node count |
| `handleEditorMarkdownChange` | 3× IPC per keystroke | autosave + search + related |
| `flushAllPendingDocumentSyncs` | O(N notes) per navigation | blocks main thread |
| `$derived.by` chain (proposal) | O(1) but high frequency | re-computes on every note/proposal change |
| `attachPaneSelectionTracking` | O(1) but high frequency | fires on every selectionchange |
| `Notepad.svelte` component size | 2586 lines | large reactive graph |
