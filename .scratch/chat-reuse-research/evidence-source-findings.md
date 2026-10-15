# Composing an agent engine with reusable evidence handling

Research date: 2026-10-15. Scope: Open WebUI source/citation handling, its suitability beside Pi or another durable engine, and library alternatives. No production edits or runtime integration tests. Source inspection uses Open WebUI `v0.11.4`, historical `v0.6.5`, LlamaIndex Python `v0.14.24`, and explicitly identified moving AI SDK `main`/docs. These are inspected versions, not claims that they are the newest releases.

## Answer

Combining an upstream session engine with evidence patterns from another project is a sound option. The reusable seam is **tool results plus separately recorded source records**. It does not require adopting the second application's agent/session engine. Open WebUI is a useful implementation reference and historical source for a citation UI, but its current evidence subsystem is not a clean, independently packaged library that can simply replace Gneauxghts evidence handling. The inspected code ties Python retrieval and chat middleware to Open WebUI models/configuration, and its Svelte presentation to application stores and components. This is an integration assessment from the paths below, not a claim that extraction is impossible.

Do not count source numbering, retrieved passages, and citation panels as a complete replacement for mutable-note evidence identity and freshness. Likewise, do not preserve every custom component merely because these domain requirements exist: an engine may own durable storage of opaque evidence records while Gneauxghts supplies the validation callbacks.

## Open WebUI: what is actually implemented

| Layer | Inspected behavior | Reuse assessment |
| --- | --- | --- |
| Retrieval | `get_sources_from_items` assembles `source`, `document[]`, `metadata[]`, optional `distances[]`; access filtering and vector retrieval are inside the same module. | Good interchange pattern; Python/Open WebUI store integration makes whole-module reuse costly. [Source](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/retrieval/utils.py) |
| Model context | `get_source_context` maps source identities to numbered source tags. Native tool results are also converted into source records and accumulated across tool iterations. | Useful adapter design; preserve a stable passage ID distinct from the model's display number. The implementation resides in the application's large middleware module. [Source](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/utils/middleware.py) |
| Source persistence | Socket source/citation events append records to a message's `sources` metadata through the chat store. | Evidence survives with the answer; this is not a separate evidence database/API to import. [Socket persistence](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/socket/main.py), [chat model/store](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/models/chats.py) |
| Citation presentation | Svelte groups chunks by source, maps numbered references to a source modal, and shows source content/metadata/relevance. Imports include app stores, i18n, Modal, Markdown, and API constants. | Closest language/UI fit, but extraction needs replacement of those dependencies. [Citation list](https://github.com/open-webui/open-webui/blob/v0.11.4/src/lib/components/chat/Messages/Citations.svelte), [modal](https://github.com/open-webui/open-webui/blob/v0.11.4/src/lib/components/chat/Messages/Citations/CitationModal.svelte) |

The default RAG template requests numbered citations only for sources carrying IDs; it permits an explicitly disclosed answer from the model's own knowledge when the context does not answer the question. That is a product policy to choose deliberately, rather than inherit accidentally. The examined path does not run a claim-entailment verifier. [Template](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/config.py)

The citation modal's content links use a file endpoint/page or a web URL/text fragment; relevance is computed from supplied retrieval distances. Inference: these links and scores do not themselves prove exact immutable-note provenance or semantic support for an answer. The preview also normalizes display whitespace. Keep captured bytes separate from presentation. [Modal](https://github.com/open-webui/open-webui/blob/v0.11.4/src/lib/components/chat/Messages/Citations/CitationModal.svelte)

Its docs cover document attachment, full-context/retrieval choices, hybrid/reranking and structured Markdown splitting, giving us useful comparison scenarios. These are established retrieval capabilities, not evidence of superior citation accuracy on our vault. [RAG docs](https://docs.openwebui.com/features/chat-conversations/rag/)

### Copying versus modeling

Current `v0.11.4` uses the Open WebUI License with a branding condition and exceptions, including deployments of at most fifty users within a rolling thirty days and specific permission/enterprise licensing. Its citation component explicitly points to the license next to its fallback logo. Do not describe current Open WebUI as MIT/Apache or assume changing an extracted component's branding is unrestricted. [Pinned license](https://github.com/open-webui/open-webui/blob/v0.11.4/LICENSE), [component](https://github.com/open-webui/open-webui/blob/v0.11.4/src/lib/components/chat/Messages/Citations.svelte)

`LICENSE_HISTORY` preserves earlier licenses. I verified `v0.6.5/LICENSE` contains the three BSD-style redistribution conditions, and the citation component exists at that tag without a visible per-file license override. `v0.6.6` already has branding conditions. A potential source-vendoring option is therefore the **verified v0.6.5 component and its audited dependency closure**, retaining required notices. This is a concrete historical candidate, not a clearance of all assets/dependencies or later backports. Taking old code also forfeits later fixes unless individually evaluated. [History](https://github.com/open-webui/open-webui/blob/v0.11.4/LICENSE_HISTORY), [v0.6.5 license](https://github.com/open-webui/open-webui/blob/v0.6.5/LICENSE), [v0.6.5 component](https://github.com/open-webui/open-webui/blob/v0.6.5/src/lib/components/chat/Messages/Citations.svelte), [v0.6.6 license](https://github.com/open-webui/open-webui/blob/v0.6.6/LICENSE)

Prefer studying the source-record/context/rendering separation and implementing our own small adapter over importing the current Open WebUI backend. Familiar UX can be modeled independently; distinguish that from copying implementation or assets.

## Other concrete reuse candidates

**Vercel AI SDK** has actual library types for URL/document sources, typed custom `data-*` UI parts, and provider-metadata extension points. Current inspected `main` also separates citations on text parts from the retrieved source inventory. This offers a cleaner transport/persistence boundary than Open WebUI's application internals; a typed `data-evidence` part can carry our passage metadata without pretending a generic document-source part enforces our policies. [UI message source](https://github.com/vercel/ai/blob/main/packages/ai/src/ui/ui-messages.ts)

Its docs demonstrate forwarding provider sources to the client and rendering URL/document source parts; this is reusable source delivery, not a local-vault retrieval engine or claim verifier. License is Apache-2.0. Exact package versions must be pinned and checked in a spike: moving `main` features are not proof that the installed release supports them. [Sources documentation](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot#sources), [license](https://github.com/vercel/ai/blob/main/LICENSE)

**LlamaIndex Python CitationQueryEngine** is an independently callable, MIT-licensed citation synthesis implementation. It accepts a retriever, configurable citation splitter, postprocessors, and response synthesizer. It re-chunks retrieved nodes, issues source numbers, and prompts grounded answers; the inspected version explicitly creates new citation-node IDs and clears original character offsets because those offsets no longer describe the split text. It therefore cannot supply Gneauxghts exact-note-range semantics without an adapter retaining those separately. This is a useful server-side comparison baseline, but adding Python just for citations is a poor native iOS reuse path. I did not verify a corresponding current TypeScript CitationQueryEngine and do not recommend one based on name similarity. [Pinned implementation](https://github.com/run-llama/llama_index/blob/v0.14.24/llama-index-core/llama_index/core/query_engine/citation_query_engine.py), [license](https://github.com/run-llama/llama_index/blob/v0.14.24/LICENSE), [official example](https://developers.llamaindex.ai/python/examples/query_engine/citation_query_engine/)

The practical distinction is that Open WebUI is mature as a complete product, AI SDK as a library boundary, and LlamaIndex as a retrieval/synthesis framework. None of the inspected evidence components establish a tested native iOS embedding/recovery contract. Product popularity does not remove those integration checks.

## Proposed composition boundary

This is a design proposal to evaluate, not an adopted architecture change:

1. **Engine owns generic execution:** session/messages, tool-call lifecycle, persisted wait/resume, model/provider adaptation, and recovery of its own workflow state. One durable owner should replace corresponding custom state rather than mirror it.
2. **Gneauxghts tools own note authority:** accept explicit scope/grants, retrieve canonical passages, produce stable evidence IDs, revalidate on replay/delivery/navigation, and expose reviewed mutation operations through NoteTimeline. Engine replay must call those operations with an idempotent intent ID rather than repeat a file write.
3. **Evidence record is engine-neutral:** originating run/turn and tool-call IDs; stable evidence ID; Note Identity; current-content hash or immutable Revision Identity; exact captured excerpt and location/range; scope/grant binding; current/historical labels. Model-facing source numbers are only per-answer aliases. Store opaque records with engine state if its persistence contract permits, while retaining app validation ownership.
4. **UI consumes two projections:** answer text plus admitted evidence records; source inspection does not call a second model. Use Open WebUI to compare interactions and AI SDK types/custom data for transport where useful. Keep retrieval scores separate from any model/evaluator judgment of claim support.
5. **Replay policy remains explicit:** archived answer visibility is separate from permission to feed old note claims back into inference. The current app omits note-grounded answers from later history/compaction and retrieves fresh evidence. Either retain that policy through upstream hooks or explicitly revisit ADR 0009; copying a conventional transcript replay would violate it.

The current app already provides `PassageCitation` (Note Identity/hash/ranges/excerpt/Revision proofs), exact issued-source binding, and backend validation. These are concrete capabilities to preserve behind a thinner tool boundary, not a justification for keeping the whole custom chat runtime. See [evidence owner](../../src-tauri/src/services/evidence.rs), [citation admission](../../src-tauri/src/chat/citations.rs), [behavior invariants](../../docs/architecture/behavior-invariants.md), [ADR 0009](../../docs/adr/0009-allow-scoped-retained-activity-evidence.md), and [architecture](../../ARCHITECTURE.md).

## Minimal evidence acceptance checks for the engine spike

- Restart after retrieval and before final answer: same persisted source bindings, no fabricated or renumbered references.
- Edit/rename/exclude a cited note while a run waits: current access/hash validation works; historical citations open their exact retained revision.
- Resume from old history or compaction: prior assistant claims do not become new primary evidence.
- Excerpt-only, table/list and topic-change queries: model sees the actual scoped passages; compare claim support with the same model and source budget across engines.
- iOS termination/relaunch: evidence state survives via the chosen engine's real supported persistence path; merely rendering the citation UI in WKWebView does not establish this.

Recommendation: compose the selected execution engine with Gneauxghts note-evidence tools; use Open WebUI as a reference implementation and optional audited historical UI source, with AI SDK source/data parts as the stronger reusable library candidate. Do not add a second complete RAG application's server solely for its citation panel.
