# Trace and AI Elements provenance

Trace and the adjacent `shimmer.css` utility are adapted from
[shadcn-svelte](https://github.com/huntabyte/shadcn-svelte/tree/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b),
commit `7e463da6dbf4b9cf086ce3e7d845650bc2a1163b` (MIT; notice in `LICENSE`).

Sources: `docs/src/lib/registry/ui/trace/`, `packages/cli/src/tailwind.css`, and
the [Task](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/content/ai-elements/task.md)
and [Queue](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/content/ai-elements/queue.md)
patterns.

Only used primitives are copied. Imports target the existing local Collapsible
components; Lucide replaces the registry icon placeholder. Local spacing, focus
rings and bounded scrolling fit the existing chat. Content uses Bits UI's hidden
state without expansion animations, preserving nested disclosures across collapse.
Shimmer retains upstream's gradient, dark/RTL treatment and timing, with feature
detection and reduced-motion handling inside the utility so status variants also
keep readable text. Unused shimmer customization utilities are omitted.

`PiActivityGroup.svelte` composes the Task pattern around observed Pi activity,
retaining collapsed-by-default groups. `PiQueue.svelte` adapts Queue's section/list
presentation to Pi inbox submissions, rather than the upstream agent todo demo.
Only disclosure state is local. Pi remains the execution and queue owner; actions
use the existing binding. No AI SDK runtime or second task/queue store is added.
