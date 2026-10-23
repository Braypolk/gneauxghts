# Pi filename editing: primary-source comparison

Reviewed 2026-10-22. Initial comparison followed by the accepted identifier decision; implementation and validation are recorded in [the outcome](README.md).

## Findings

**A separate rename operation is a conventional design, but the reviewed sources do not establish one universal standard or prove it performs better for models.** Pi's general file writer does not itself rename files. In the installed `@earendil-works/pi-durable` **1.3.0**, `write` accepts `{ path, content }`; it creates or overwrites content at that path. `edit` accepts `{ path, edits: [{ oldText, newText }] }`, and replaces content in that existing file. The current official implementations preserve those distinctions. Writing the same bytes to a different path would create another file; it does not remove or rename the original. Sources: installed [write implementation](../../../node_modules/@earendil-works/pi-durable/dist/tools/write.js), [edit declarations](../../../node_modules/@earendil-works/pi-durable/dist/tools/edit.d.ts); upstream [write source](https://github.com/earendil-works/pi/blob/main/packages/durable/src/tools/write.ts), [edit source](https://github.com/earendil-works/pi/blob/main/packages/durable/src/tools/edit.ts).

Pi's underlying `FileSystem` environment separately exposes `writeFile(path, content, context)` and `renameFile(sourcePath, destinationPath, context)`. Having general filesystem mutation capability at the environment layer therefore does not imply that the model-facing `write` tool supports renaming. Source: installed [environment declarations](../../../node_modules/@earendil-works/pi-durable/dist/env/index.d.ts); [official environment source](https://github.com/earendil-works/pi/blob/main/packages/durable/src/env/index.ts).

The MCP reference filesystem server likewise exposes separate `write_file`, `edit_file`, and `move_file` tools. Its move tool handles renaming and changing directories, validates both source and destination against allowed directories, and describes a no-overwrite policy. This is an example of **shared access scope with distinct operation interfaces**, rather than evidence that each tool requires a separate user-facing permission switch. Source: [official filesystem server implementation](https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/server.ts).

Neither installed `pi-ai`'s generic `Tool` interface nor `pi-durable`'s custom-tool API requires a particular note-tool shape. `pi-ai` declares a tool's name, description, schema and optional constrained sampling; `pi-durable` supports custom tools and hooks that block or rewrite calls. Thus permission bundling is a host application decision, independent of whether the model sees one tool or several. Sources: installed [pi-ai types](../../../node_modules/@earendil-works/pi-ai/dist/types.d.ts), [pi-durable README](../../../node_modules/@earendil-works/pi-durable/README.md); official [pi-ai types](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts), [custom tools and hooks documentation](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md).

## Application to this app

Our `rename_note` is a domain-level operation, not a title-generation tool: it accepts exact Note Identity, proof of the current read, and the requested title. It preserves the current folder and note bytes, rejects collisions and routes through the **same publication adapter** used by edits and creation. It is deliberately narrower than a filesystem `move_file`. The initial separate rename permission was a host policy, not a Pi SDK requirement; it has since been unified with note editing. Sources: [rename tool](../../../src/lib/features/chat/pi/rename.ts), [shared publication adapter](../../../src/lib/features/chat/pi/mutationTool.ts).

## Recommendation options (design judgment)

1. **Recommended first step:** retain clear `edit_note` / `rename_note` operations and offer a single user-facing **Modify existing notes** permission covering content, authored properties and filenames. Preserve operation-specific native validation and review. This directly simplifies access configuration without changing model schemas or rename consistency behavior.
2. A coherent broader interface is `update_note({ noteId, expectedReadSourceId, title?, edits? })`. It could support title-only, content-only, or combined changes. This is worthwhile if combined updates are a real workflow: it requires a defined atomic contract, unified exact review, post-commit reads, collision handling, editor synchronization and crash recovery. Merely calling the two existing writes in sequence would not supply atomicity.
3. Replacing the note APIs with raw Pi `write` / `edit` / `bash` would expose path-based, general filesystem semantics and require the app's note identity, ownership and publication protections to be rebuilt at that lower boundary. The reviewed sources provide no reason to expect that to simplify this app.

The original comparison did not establish a tool-selection benchmark or reliability advantage. Implementation and compatibility details are recorded in the outcome. Upstream links target moving `main`; installed 1.3.0 files are the version-specific evidence.

## Follow-up: explicit targets and read receipts

The installed Pi Durable 1.3.0 `createEditTool` takes an explicit `path` and an
`edits` array of `oldText`/`newText` replacements. It reads the file during
execution and requires each replacement to match uniquely without overlaps. It
does not require a prior-read receipt. See the installed
[edit implementation](../../../node_modules/@earendil-works/pi-durable/dist/tools/edit.js)
and [official source](https://github.com/earendil-works/pi/blob/main/packages/durable/src/tools/edit.ts).

Retain `noteId` and `expectedReadSourceId` in both `edit_note` and `rename_note`.
The explicit Note Identity plays the targeting role that `path` plays in Pi,
while the issued read source adds this app's exact-base freshness check. Native
code verifies that they agree. Receipt-only targeting was an application-specific
simplification proposal, not Pi's convention; it is withdrawn. The implementation
keeps the current model schemas, generalizes their receipt help to any committed
publication read, and tests both hosted and local serialized schemas.
