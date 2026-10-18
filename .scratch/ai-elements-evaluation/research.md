# AI Elements evaluation

Researched 2026-10-17 against primary documentation and public source. This is an evaluation, not an implementation plan or change to the accepted Pi ownership decision.

## Recommendation

Use selected AI Elements presentation patterns from **shadcn-svelte's own collection**, adapted to Pi-owned data. Start with task/activity presentation, subtle shimmer and the existing queued-submission UI. Add citation previews when they improve note navigation. Add a context-window meter only after a truthful current-context measurement exists. Copying a pattern does not require adopting AI SDK or changing the runtime.

The current [shadcn-svelte AI Elements overview](https://shadcn-svelte.com/docs/ai-elements) explicitly says these are owned-source compositions of shadcn-svelte components, rather than a package. Its examples use `@ai-sdk/svelte`, but the patterns read message parts and support other message sources. This fits [ADR 0012](../../docs/adr/0012-found-ordinary-chat-on-pi.md): Pi owns scheduling, queueing, progress, usage, history and generation; Gneauxghts owns presentation and native source admission/navigation authority.

## Which project

- Original [Vercel AI Elements](https://github.com/vercel/ai-elements) ships React components. Both its repository README and [live site](https://elements.ai-sdk.dev/) announce migration to shadcn/ui and deprecation of this project at the end of November 2026. Its new-project direction is the [shadcn/ui AI Elements patterns](https://ui.shadcn.com/docs/ai-elements).
- The [shadcn-svelte collection](https://shadcn-svelte.com/docs/ai-elements) offers the corresponding Svelte patterns on the same component system this app already uses. This is the best starting point for this app; it is shadcn-svelte's own collection, not Vercel-maintained Svelte support. [shadcn-svelte itself](https://github.com/huntabyte/shadcn-svelte) identifies as an unofficial community-led shadcn/ui port.
- The separately maintained [SikandarJODD/ai-elements](https://github.com/SikandarJODD/ai-elements), deployed at [svelte-ai-elements.vercel.app](https://svelte-ai-elements.vercel.app/), explicitly identifies as an unofficial Vercel AI Elements port. Its documentation and registry are another source, but introducing that extra upstream is unnecessary when the main shadcn-svelte project now documents these patterns.

## Source inspected

Inspected shadcn-svelte main at [commit `7e463da6dbf4b9cf086ce3e7d845650bc2a1163b`](https://github.com/huntabyte/shadcn-svelte/commit/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b), committed 2026-10-15. Read the four pattern Markdown source files and Trace/Hover Card/CSS implementation directly from this commit. The web reader failed to load individual pattern pages; raw source fetched successfully. The original React project and separate Svelte port were inspected through their live docs/README, not a pinned release/source audit.

| Pattern | Verified structure and useful behavior | Fit and constraints here |
| --- | --- | --- |
| Task | [Pattern source](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/content/ai-elements/task.md) composes Trace and Collapsible. Steps appear as work happens; pending future steps belong in Plan. Running/error are presentation statuses. | Strong fit for observed Pi tools and reasoning. Preserve truthful observed events and existing activity grouping rather than inventing planned steps or another task state owner. |
| Shimmer | [Documentation](https://shadcn-svelte.com/docs/utils/shimmer) and [CSS source](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/packages/cli/src/tailwind.css) implement text shimmer entirely in CSS, with reduced-motion handling and RTL direction. | Small, useful addition to a single live status label. No animation library required. Stop when Pi stops. On older WebViews unsupported relative color syntax can make shimmer text transparent; use feature detection/fallback as docs prescribe. |
| Queue | [Pattern source](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/content/ai-elements/queue.md) is an agent todo list split into To do/Completed, composed from Trace/Collapsible; example reads latest `writeTodos` tool call. | Adapt visual list structure to the existing Pi InboxDoc queued inputs and withdraw action. A queued user submission is not an agent todo; do not import the example's whole-list tool/state semantics. |
| Inline citation | [Pattern source](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/content/ai-elements/inline-citation.md) is Hover Card + Button. Example uses web hostname/title/URL and `source-url` parts. | Good preview treatment for admitted note citations. Show note titles, native-admitted evidence and optional verified passage; retain native permission/identity recheck on click. Existing Markdown HTML renderer needs deliberate integration to mount Svelte cards. Hover must be supplemented by explicit keyboard/touch navigation. |
| Context | [Pattern source](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/content/ai-elements/context.md) is Hover Card + Progress + Button, takes used/limit values; capacity comes from the selected model. | Useful eventually, but Pi cumulative token spend must not become the current context numerator. Need actual active/replayed context usage, current model capacity and behavior after compaction. Unknown capacity should show unknown rather than 0%. No TokenLens dependency is inherent in this new pattern. |

## Dependencies, accessibility and maintenance

The inspected pattern snippets import presentation components, not AI SDK runtime hooks; the AI SDK sections illustrate one possible data adapter. [Trace line](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/src/lib/registry/ui/trace/trace-line.svelte) renders a span with running/error/pending data status; [Trace title](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/src/lib/registry/ui/trace/trace-title.svelte) applies reduced-motion styling. [Trace trigger](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/src/lib/registry/ui/trace/trace-collapsible-trigger.svelte) uses the shadcn Collapsible wrapper and Bits UI trigger types. [Hover Card root](https://github.com/huntabyte/shadcn-svelte/blob/7e463da6dbf4b9cf086ce3e7d845650bc2a1163b/docs/src/lib/registry/ui/hover-card/hover-card.svelte) wraps Bits UI LinkPreview. These primitives help with interaction semantics; they do not prove the composed app is accessible. Verify keyboard focus, touch, screen-reader status wording, reduced motion and light/dark contrast in actual desktop/iOS WebViews.

Shimmer currently ships in `shadcn-svelte/tailwind.css`; this repository does not currently install the `shadcn-svelte` package, per the parent agent's local inspection. Therefore adding only a class would not supply the CSS. Import a reviewed utility or install the matching package after checking its integration. Likewise inspect registry output before introducing current Trace/Marker/Button variants into the app's existing copied component generation. Do not assume the latest docs are a drop-in match for older local primitives.

Owned-source components remove runtime lock-in but leave local responsibility for upgrades and fixes. Copy only used components, record upstream provenance, and keep Pi-specific mapping in the existing presentation seam. Do not restore all deleted wrappers or add `@ai-sdk/svelte` for visual components.

## Local integration evidence supplied by parent inspection

- `ChatPanel.svelte` already renders queued Pi InboxDoc inputs with withdraw buttons.
- Current working-tree `PiActivityGroup`/activity transcript helpers group real tools/reasoning; `piProgress` derives Waiting/Thinking/Writing/tool descriptions from observed state. Preserve these users' ongoing changes.
- `PiMarkdown` currently renders Markdown HTML and delegates `data-pi-source` clicks. Rich citation components need renderer integration while preserving terminal native admission and navigation authority checks.
- Installed Pi `UsageDoc` describes cumulative spend. `viewUsage` exists but does not establish active context-window usage; model-limit lookup maps unknown capacity to zero. A context percentage needs a better data contract.

These points were supplied by the parent agent's local code investigation; this research subtask did not independently audit those files or change application code.

## Limits

No components installed, app code changed, browser interactions tested or bundle benchmarks run. No full accessibility audit or independent maintenance-health comparison performed. Verify registry output, available local component variants, licensing attribution and real context telemetry during implementation. Original and separate-port source APIs beyond inspected docs were not exhaustively compared.
