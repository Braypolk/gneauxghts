# Reusing existing chat products and engines in Gneauxghts

Research date: 2026-10-15. Primary official documentation and repository source checked on this date. This is a desk investigation, not a comparative benchmark or installation test. Feature descriptions establish availability, not superiority, correctness, or stable integration contracts. Sources on `main`/`master` and documentation marked latest/dev can describe unreleased behavior; a prototype should pin a release and commit.

Follow-up: [engine decision research](engine-decision.md) supersedes this initial scan's conditional engine ranking with released-source inspection and isolated package/browser tests. Pi Durable's portable core is browser-capable despite its Node manifest; established Pi extensions use a different API. The follow-up distinguishes local iOS execution from a native chat client using a server.

## Finding

The concern is substantially correct: general chat, provider routing, streaming, conversation management, tools, RAG, and source displays already exist in configurable products. Building all of those again is avoidable. The user has clarified that chat must stay inside Gneauxghts. For that requirement, a runtime/SDK behind the existing seam is more promising than transplanting a whole application. The product scan below establishes available functionality and explains why these products are not simple drop-in packages.

However, this scan does not establish that another product satisfies Gneauxghts' stronger contracts: Markdown as canonical storage, reviewed durable note proposals, note identity/revision-aware citations, scope enforcement, and recovery integrated with open editors. Nor does advertised citation support establish that cited passages entail individual claims. Those require direct evaluation with this app's cases.

Repository comparison baseline: [ARCHITECTURE.md](../../ARCHITECTURE.md) assigns durable runs/context/proposals to ChatService and canonical note writes to NoteTimeline; [ADR 0001](../../docs/adr/0001-keep-agent-runtime-app-owned.md) deliberately permits provider/runtime replacement behind an app-owned seam while retaining lifecycle, events, guardrails, proposal policy, and permissions. This is an architectural decision that can be revisited, not a reason to dismiss alternatives.

## Full products worth comparing

| Candidate | What is reusable | Fit and principal limitation |
| --- | --- | --- |
| AnythingLLM | MIT core; desktop app or self-hosted API; document chat and tools | Strongest permissive full-product/API candidate. Its React/Node stack and document-ingestion model differ from this Rust/Svelte vault app. |
| Open WebUI | Svelte UI, Python server; local/provider chat, RAG, tools, notes | Closest frontend language. Custom branding terms complicate a Gneauxghts-branded distributed fork; native note history does not match our contract. |
| LibreChat | MIT web application; broad agents/provider/UI capabilities | Strong configurable standalone chat platform. A multi-service deployment is a substantial addition to a native app. |
| Obsidian Copilot V4 | Existing vault-oriented agent experience; OpenCode/Claude/Codex integration | Strongest evidence this workflow is already a product. AGPL plugin, Obsidian-specific APIs/UI, desktop agent processes; better as an alternative product/reference than a drop-in library. |
| Khoj | Self-hosted personal knowledge assistant, retrieval, agents, automation | Relevant functional substitute. AGPL and Python/server/database architecture make native embedding expensive. |

### AnythingLLM

Its official repository describes desktop builds, local/cloud providers, source citations, custom agents, a developer API, and a React frontend with Node Express server and collector. This is an application backend, not an embeddable Rust crate. [Official repository](https://github.com/Mintplex-Labs/anything-llm)

The API can manage, update, embed, and chat with workspaces; live endpoint documentation lives at `/api/docs` on an instance. That offers a concrete service integration path. [API documentation](https://docs.anythingllm.com/features/api)

The ready-made script-tag chat widget is explicitly Docker-only. It should not be mistaken for a standalone offline desktop chat engine. [Embedded chat widgets](https://docs.anythingllm.com/features/chat-widgets)

Agent Flows provide visual custom skills in both desktop and Docker. This establishes extensibility, but the reviewed page does not establish durable approval of canonical vault writes or exactly-once execution across crashes. [Agent Flows](https://docs.anythingllm.com/agent-flows/overview)

Its core [MIT license](https://github.com/Mintplex-Labs/anything-llm/blob/master/LICENSE) permits modification, commercial use, and redistribution with copyright/license notices retained. The self-hosted terms describe air-gapped operation using local models/vector storage and optional telemetry; model assets may need prefetching. Cloud providers and external tools naturally change that data boundary. Separate paid services and third-party model licenses need their own assessment. [Self-hosted terms](https://github.com/Mintplex-Labs/anything-llm/blob/master/TERMS_SELF_HOSTED.md)

**Assessment:** first full-product candidate to trial if the objective is to stop developing general chat. Likely integration work: expose current-note reads/search and proposal submission through controlled tools; decide whether its conversations remain separate. Avoid exporting all notes into a second ingestion/index lifecycle unless that tradeoff is acceptable.

### Open WebUI

The project supports local Ollama and OpenAI-compatible endpoints and describes offline operation. Its source manifest uses Svelte 5/SvelteKit, while backend dependencies include Python FastAPI, Uvicorn, SQLAlchemy, and retrieval libraries. Shared Svelte syntax helps UI familiarity, but does not make it a supported component library or remove its server. [README](https://github.com/open-webui/open-webui/blob/main/README.md), [frontend manifest](https://github.com/open-webui/open-webui/blob/main/package.json), [backend requirements](https://github.com/open-webui/open-webui/blob/main/backend/requirements.txt)

Current licensing permits source/binary modification and redistribution subject to conditions, including preserving Open WebUI branding except for deployments/distributions with at most 50 end users in a rolling 30 days, written permission, or an enterprise license. Earlier contributions retain their original licenses. This is not an unrestricted MIT-style white-label foundation. [Controlling LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE), [license explanation](https://docs.openwebui.com/license/)

Its notes support model-driven create/read/search/replace operations. Range replacement can reject stale expected text. However, official docs explicitly say notes keep no server-side history; editor Undo/Redo may not cover tool edits. This is material evidence against equating its note editing with durable reviewed proposals. Notes are application objects with Markdown import/export rather than evidence of transparent canonical vault ownership. [Notes documentation](https://docs.openwebui.com/features/notes/)

RAG retrieves passages into a prompt and displays citations. Documentation warns that context limits can prevent retrieved text being used. Experimental external-vector integration supports Qdrant, Milvus, and pgvector; it is not direct reuse of our SQLite/ANN retrieval seam. None of this demonstrates claim-by-claim entailment. [RAG documentation](https://docs.openwebui.com/features/chat-conversations/rag/)

**Assessment:** good standalone comparison, and potentially a branded side application connected to note tools. A full Gneauxghts-branded fork or selective UI extraction needs license review and would acquire Python/server maintenance. Frontend language compatibility alone is insufficient justification.

### LibreChat

The repository documents broad providers, OpenAI-compatible custom endpoints, conversation branching, agents, MCP, skills, compaction, traces, and file search. Recent attached-workspace editing is expressly described as highly experimental. Its [MIT license](https://github.com/LibreChat-AI/LibreChat/blob/main/LICENSE) allows commercial modification/distribution with notices. [Official repository](https://github.com/LibreChat-AI/LibreChat)

This is a self-hosted web product. The default Compose file includes application API, MongoDB, Meilisearch, a RAG API, and pgvector/Postgres. Those are its current default services, not a claim every configuration requires every service. That deployment footprint is a poor match for simply inserting chat into the existing Rust binary. [Compose source](https://github.com/LibreChat-AI/LibreChat/blob/main/docker-compose.yml)

Agents support file search and configurable tools. Current docs also describe background tool continuations with durable terminal results, so it would be wrong to claim LibreChat has no durable workflows. That still does not establish equivalence to our note publication/review invariants. File-write permission choices are distinct from atomically committing a reviewed proposal through NoteTimeline. [Agents documentation](https://www.librechat.ai/docs/features/agents)

**Assessment:** strongest option when prioritizing a broad configurable ChatGPT-style web platform. More attractive as a separately running UI with a note MCP server than as a fork embedded into Tauri/iOS. Scope preservation and citation fidelity would still need testing.

### Obsidian Copilot V4

Current V4 documentation describes running OpenCode, Claude Code, and Codex in an Obsidian vault, with local/API models, project context, Quick Ask rewriting, and local Miyo search. Agents are desktop-only because their backends run local processes; simpler chat/commands remain mobile-capable. Hosted services are proprietary, separate from the open plugin. [Current README](https://github.com/logancyang/obsidian-copilot/blob/master/README.md)

It uses a pinned `@agentclientprotocol/codex-acp` runtime, supports resuming saved chats, and records conversations as Markdown notes. The Files changed view reviews edits after a turn; review cards/diffs disappear when the plugin or app reloads, and shell-made changes are outside that view. Therefore this is an existing useful review workflow, but not evidence of durable pre-commit approval. [Agent workflow documentation](https://github.com/logancyang/obsidian-copilot/blob/master/docs/agent-mode-and-tools.md)

The plugin is [AGPL-3.0](https://github.com/logancyang/obsidian-copilot/blob/master/LICENSE), confirmed in its [manifest](https://github.com/logancyang/obsidian-copilot/blob/master/package.json). Commercial use is allowed; distributing covered modified works requires AGPL compliance and corresponding source, while remote interaction with a modified network service can trigger its source-offer requirement. This does not automatically determine the license of a genuinely separate client, but copying tightly integrated code is materially different from MIT reuse.

**Assessment:** a strong buy/use alternative if the user is willing to use Obsidian, and a compelling example of letting established agent runtimes own generic reasoning/tool loops. An Obsidian plugin is not a general Svelte/Tauri package; copying it would also import host assumptions and copyleft constraints.

### Khoj

Khoj's official description includes local/cloud model chat, Markdown and other document retrieval, semantic search, custom agents, and scheduled research, with browser/Obsidian/desktop/phone clients. [Official repository](https://github.com/khoj-ai/khoj)

Self-hosting supports offline use with local models, installed as a Python server or through Docker; OpenAI-compatible endpoints include Ollama/LM Studio. The default Compose source includes pgvector/Postgres plus sandbox, search, computer, and server components; some functions are optional. This is a personal knowledge service rather than a Rust library. [Self-hosting documentation](https://docs.khoj.dev/get-started/setup/), [Compose source](https://github.com/khoj-ai/khoj/blob/master/docker-compose.yml)

Its [AGPL-3.0 license](https://github.com/khoj-ai/khoj/blob/master/LICENSE) carries the same covered-work/source obligations described above. The checked docs do not establish durable vault proposal review or immutable note-revision citations; absence of that evidence is not proof those features cannot be implemented.

**Assessment:** credible separate assistant to evaluate for research/search, less compelling than AnythingLLM for a permissive app fork or than a runtime SDK for native integration.

## Suggested next experiment

Pause additional general chat features while comparing a reusable runtime against representative Gneauxghts tasks. Keep chat inside Gneauxghts, as requested. The complete products above provide feature and workflow references; recommending a separate application or moving into Obsidian would not satisfy that requirement. Do not install or migrate user data as part of this research alone.

1. Prototype one runtime behind the existing app-owned seam; retain the Svelte interface and canonical note owner. Compare the behavior to the existing Rig-backed path before committing to a migration.
2. Give each candidate the same scoped note questions, list/table evidence, topic changes, and absent-evidence questions. Record raw tool reads, resolved citations, answer support, context cost, and latency. A polished source card is insufficient.
3. Test a note rewrite with concurrent editor changes and restart during approval. Require the Gneauxghts owner to publish approved writes if preserving its existing durability/editor guarantees.
4. Compare actual integration/deployment cost against keeping ChatService/NoteTimeline and replacing only the agent engine. A full application backend can replace more features but shifts storage, maintenance, and platform tradeoffs.

Recommended integration boundary: expose narrow app-owned `search/read/propose` tools to the embedded runtime, using its native custom-tool interface or an appropriate protocol. Keep canonical note writes in Gneauxghts. The engine submits a proposal and receives its status; Gneauxghts owns review, freshness validation, and publication. This is a proposed integration, not an existing implemented feature or a claim every candidate enforces our policy automatically.

## Embedded libraries and engines

The user clarified that chat must remain inside Gneauxghts. The products below are comparison material; the main decision is how much of the embedded implementation an upstream engine can own.

| Candidate | Verified reusable surface | Integration assessment for this repository |
| --- | --- | --- |
| Pi SDK / agent core | Tool execution, streamed events, sessions, retry/compaction events, custom models/tools/resource loading. MIT. | Strong candidate for replacing a broader agent-session layer. TypeScript integration; normal Node-based deployment introduces a desktop runtime/bridge and requires a separate mobile feasibility check. |
| Goose / GDK | Rust in-process provider SDK, streaming, reasoning/tool-call chunks, context compaction; full Goose source also exports agent/session/permission modules. Apache-2.0. | Closest alternative engine language match. The documented SDK is alpha and its advertised provider surface should not be mistaken for the entire Goose agent and session implementation. |
| AI SDK | Official Svelte client, streaming/tool APIs, approval requests, custom transports. Apache-2.0. | Plausible incremental replacement for generic frontend state/transport; a Tauri transport and domain event mapping would be custom work. Using its TypeScript backend is a separate migration. |
| AI SDK HarnessAgent | Shared interface over existing agent runtimes, sessions, custom tools, skills and permission configuration. | Wider reuse than a provider SDK; explicitly experimental. Runtime location depends on adapter. Does not establish iOS support or remove engine-specific semantics. |
| OpenCode SDK/server | Typed JS/TS client; can start server or connect to one; configurable tool permissions. MIT. | Could keep the Gneauxghts UI and use a companion agent server. Extra process, session ownership and packaging need proof; not a Rust in-process library. |
| LangGraph JS | Checkpointers, stores, resumable human review and failure handling. MIT source license. | Suitable when replacing durable workflow coordination is the objective. Adds a graph runtime and persistence integration; not a ready notes-chat UI. |
| assistant-ui | React, React Native and terminal chat primitives with pluggable runtimes. MIT. | Reusable UI, but the web frontend is React rather than Gneauxghts' Svelte. Poor first choice unless a React component island or migration is acceptable. |

Primary references: [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Pi agent core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md), [Pi license](https://github.com/earendil-works/pi/blob/main/LICENSE); [Goose SDK](https://goose-docs.ai/docs/gdk/sdk/), [Goose public modules](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/lib.rs), [Goose license](https://github.com/aaif-goose/goose/blob/main/LICENSE); [AI SDK Svelte](https://ai-sdk.dev/docs/getting-started/svelte), [transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport), [tool approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [message storage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence), [license](https://github.com/vercel/ai/blob/main/LICENSE); [HarnessAgent overview](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview), [adapters](https://ai-sdk.dev/providers/ai-sdk-harnesses); [OpenCode SDK](https://docs.opencode.ai/docs/sdk/), [tool permissions](https://docs.opencode.ai/docs/tools/), [license](https://github.com/anomalyco/opencode/blob/dev/LICENSE); [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence), [human review and recovery](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph), [license](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE); [assistant-ui docs](https://www.assistant-ui.com/docs/), [license](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE).

### Pi's durable layer deserves separate treatment

Pi now also publishes `pi-durable`. Its first-party documentation describes commit-before-display, SQLite/JSONL storage, resumable tasks, compaction, child tasks and explicit tool replay policy. A mid-call crash reruns a tool only when it is declared replay-safe; external effects still need idempotency. This overlaps substantially with app-owned chat coordination.

However, its README explicitly marks the API **Experimental** and subject to change without notice. Its manifest requires Node >=22.19.0. It is a serious research candidate, not evidence of a stable, drop-in mobile backend. [README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md), [manifest](https://github.com/earendil-works/pi/blob/main/packages/durable/package.json).

## What is already reused in Gneauxghts

This repository already pins `rig-core` and `rig-agent` 0.44.0 in [Cargo.toml](../../src-tauri/Cargo.toml). The implementation constructs Rig's `AgentBuilder` and calls its multi-turn `.prompt(...).history(...).stream()` API in [agent_runtime.rs](../../src-tauri/src/agent_runtime.rs). It does not hand-implement the entire model/tool loop. Rig itself documents provider and agent/tool streaming APIs: [agent](https://docs.rs/rig/latest/rig/agent/struct.Agent.html), [tools](https://rig.rs/docs/concepts/tools/).

The local customization includes provider compatibility, reasoning discovery, run-local compaction, usage/context measurement, validated answer formatting, durable chat admission/terminal storage, transcript projection/recovery, and vault tools. The existing boundary is described in [ADR 0001](../../docs/adr/0001-keep-agent-runtime-app-owned.md) and [Architecture](../../ARCHITECTURE.md).

That boundary makes an engine comparison feasible. It is not proof that all current custom coordination is necessary. If a candidate can own sessions and recovery correctly with less glue, revisit ownership deliberately and revise ADR 0001 rather than preserving duplicate state merely to obey the old split.

## Recommendation and concrete decision gate

**Pause broad custom chat expansion and test upstream reuse before committing more effort.** The research establishes feature overlap and integration options; it does not establish better answer accuracy or lower total maintenance cost.

For embedded chat, the strongest bounded comparison is **current Rig versus Pi's session SDK and Goose's Rust engine components**. AI SDK is additionally relevant for generic Svelte client state, and its harness interface is worth evaluating if the TypeScript execution route passes packaging constraints. These candidates have different scopes; comparing only their provider APIs would not answer whether broader chat coordination can be deleted.

Before a migration, require a disposable implementation to demonstrate:

1. The existing embedded chat UI can send, stream, cancel and retry using the same configured hosted and compatible local models.
2. Only registered vault tools are available; ordinary note writes still enter reviewed Note Proposals and NoteTimeline. Generic direct-file tools do not bypass these owners.
3. A passage answer and excerpt-only answer retain usable source navigation. Reusing a citation API does not establish that its passages support the claims.
4. Restart during a run or pending review preserves the intended state without replaying committed note effects.
5. The selected deployment works for the intended desktop and iOS architecture. A working desktop Node sidecar or server is not mobile acceptance.
6. The comparison lists custom modules actually removed, adapter modules added, remaining ownership, pinned dependency/API risks and an exit path. No arbitrary percentage-saving estimate.
7. Quality uses the same questions, sources, model/settings and budget where supported. Record failed attempts and unsupported candidate capabilities rather than calling a richer feature list “better.”

Keep the note identity/history, review and passage navigation contracts unless changing them is an explicit product decision. Generic session/event/compaction implementation is negotiable. There is no reason to require a full product fork when a supported engine interface can provide the desired reuse.

This was a documentation/source investigation on 2026-10-15, not an installation, benchmark or migration. No production code, dependency, credentials or app settings changed.

