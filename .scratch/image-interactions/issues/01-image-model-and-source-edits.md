# Parse image embeds and preserve source during size edits

Status: resolved
Type: task
Depends on: none

## Scope

Implement the parser/index and source-edit contract in [the specification](../spec.md). Replace regex-only wiki-image scanning with syntax-aware wiki and standard Markdown extraction. Preserve syntax kind, label, encoded destination, optional title, source/size spans, and ephemeral occurrence identity. Handle reference definitions without mutating shared destinations.

Keep the current wiki-image size forms readable. Reject code, comments, escaped syntax, unsupported paths, and malformed dimensions appropriately. Invalid source remains authored text. Resize/reset produces small source patches, not serialization of a lossy normalized target.

## Main files

- `src/lib/features/notepad/images/imageEmbedParser.ts`
- `src/lib/features/notepad/markdown/obsidianMarkdownExtensions.ts`
- New private image model/command helpers under `images/` as warranted.

## Acceptance

- Exact source outside the size span survives resize/reset, including labels, titles, encoded spaces, escaping, and line endings.
- Both inline and standalone images, duplicate occurrences, local reference-style images, and complete-document inventory work.
- Source edits map ranges and revalidate targets; insertion/deletion cannot redirect old references to another image.
- Focused model tests exercise the public parser/edit surface with valid, invalid, and context-exclusion fixtures.

## Comments

Initial ticket captured proposed defaults. The accepted implementation and validation are recorded below.

## Answer

Implemented syntax-aware full-note inventory for wiki, Markdown and local reference images; excluded literal/comment contexts and preserved source spans. Width/reset edits preserve destination, title, encoding and reference lookup. Parser regressions cover encoded/escaped paths, comments, collapsed/shortcut references, and exact source patches.

Evidence: [implementation validation](../validation.md).
