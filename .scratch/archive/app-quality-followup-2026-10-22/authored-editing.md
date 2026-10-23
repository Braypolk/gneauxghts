# Authored note editing

Updated: 2026-10-22

## Implemented

`edit_note` already supports authored body and frontmatter; it now states that
contract explicitly. A complete authored replacement can remove every unmanaged
property. The exact issued editing base excludes the managed namespace, while
canonical reads/citations and the full raw-byte source proof remain unchanged.
Native metadata is taken from the admitted canonical note, preserving
identity, creation and trash state while advancing update time. Model-supplied
managed metadata is rejected before review. Creation correctly separates the last
authored property from the closing YAML delimiter. Exact native review, live
editor admission and Timeline publication proofs remain mandatory.

Final independent review found that update-time wikilink unescaping could alter
unrelated body text after a property-only edit had been reviewed. The update
owner now parses the submitted authored Markdown directly. A regression first
failed on the extra body change, then passed while proving exact authored-candidate
equality and preservation of managed identity, creation and trash metadata.
Creation normalization remains represented in its prepared review preview.

Display title is the filename stem in this app. A YAML `title` property is ordinary
authored data and does not rename the file; a Markdown heading does not rename it.

## Filename tool

At this quality-pass checkpoint, the separate `rename_note` tool was only
[planned](../pi-note-rename-2026-10-22/spec.md). The subsequent
[completed implementation](../pi-note-rename-2026-10-22/README.md) records the
owner changes, collision/restart acceptance and platform limits.

## Validation

- Frontend checks covered authored-edit behavior.
- Filtered native `pi_chat::` checks covered creation frontmatter, authored-only
  editing bases with full raw proof, authored replacement/removal, managed-metadata
  rejection and exact property-only review/publication equality with escaped links.
- `pnpm check` passed with zero errors and warnings; the root pass runs whole-app
  verification after integration. These are quality-pass checkpoint results;
  filename-tool validation belongs to the subsequent rename outcome linked above.
