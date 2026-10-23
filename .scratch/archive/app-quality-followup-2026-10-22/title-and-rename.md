# Automatic capture titles and authored note editing

Updated: 2026-10-22

## Implemented

The user chose opt-in automatic titles for new captures whose title they have not
edited. The Running Vault setting defaults off. The editor owns eligibility,
title-intent/content guards and ordinary title/save adoption. The inference seam is:

```ts
getNoteTitleSettings(): Promise<{ enabled: boolean }>
setNoteTitleSettings(enabled: boolean): Promise<{ enabled: boolean }>
generateNoteTitle({ noteId, expectedTitle, expectedMarkdown }, signal?):
  Promise<{ title: string } | null>
```

`expectedMarkdown` must match the saved note's editor body, not unsaved text. Native
code resolves the note through `NoteTimeline::current_content`, verifies exact
saved bytes/title/identity, opt-in and global exclusions, and issues a two-minute
in-memory lease. The provider transcript is reconstructed natively from fixed
instructions and the first 12,000 Unicode characters of saved body. It includes no
properties, tools, attachments, chat context or other notes. Each lease uses a
unique provider session, supports cancellation and rechecks its source and
permission during dispatch and delivery. Disabling opt-in withdraws active leases.

The existing Pi Harness schedules a typed title task in one dedicated application
conversation identified by purpose. That conversation has no tools, submissions,
note grants or transcript entries and is excluded from both initial and live chat
navigation; chat binding/selection reject it. Durable task records contain job
references, provider/model and the bounded final title, never the excerpt. Tasks
are abandoned after restart because the editor's title-intent guard is transient.
The installed public Pi API has no deletion method for terminal task records, so
no direct Pi storage pruning was introduced. See accepted ADR 0013.

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
AI title inference returns a proposal to the editor and cannot publish or rename.
The editor can apply it through existing document title/save ownership without a
new Pi filesystem tool.

## Filename tool

At this quality-pass checkpoint, the separate `rename_note` tool was only
[planned](../pi-note-rename-2026-10-22/spec.md). The subsequent
[completed implementation](../pi-note-rename-2026-10-22/README.md) records the
owner changes, collision/restart acceptance and platform limits.

## Validation

- Title task/provider/runtime/chat navigation and authored-edit frontend suites:
  100 tests passed across five files. Invalid output includes names over 80 Unicode
  characters or 220 UTF-8 bytes, leaving room for extension/collision suffixes.
- Filtered native `pi_chat::` suite: 65 tests passed after the final review fix, including three title authority
  tests, creation-frontmatter regression, authored-only editing bases with full raw
  proof, authored replacement/removal, managed-metadata rejection and exact
  property-only review/publication equality with escaped links.
- `pnpm check` passed with zero errors and warnings; the root pass runs whole-app
  verification after integration.
- Integration evidence combines a browser fixture for opt-in presentation,
  controller title-intent tests, the Faux Pi task and native title-authority tests.
  No real native WebView title interaction or live-provider title-quality run was
  performed. These are quality-pass checkpoint results; filename-tool validation
  belongs to the subsequent rename outcome linked above.
