# Atlas comparables: mechanisms, useful jobs, and the differentiation bar

Research date: October 2, 2026. Primary-source desk research; no product accounts were used and no comparative usability trial was run. Read `CONTEXT.md`, `docs/agents/domain.md`, and the research skill. The ADR catalog contains no Atlas-specific decision. This document evaluates product mechanisms, not implementation compliance.

## Judgment

Semantic organization and spatial note work are established product approaches. Neither the existence of competitors nor their testimonials proves that a whole-vault map improves retention, discovery, or task speed. The strongest competing approaches make the outcome explicit: a reviewed working set, a source-backed synthesis, a project board, or a small review session. A beautiful landscape without such an outcome has a weak product proposition.

The premise “unlike Obsidian, it actually has a use of organizing notes based on ideas” needs tightening. Obsidian's native Graph is based on authored links, but its native Canvas already groups and manipulates notes spatially. Its plugin ecosystem includes semantic whole-vault maps and automatic related-note discovery. The fairer opportunity is **a coherent, approachable, local-first route from automatically discovered themes to deliberate work on notes**, with less setup and better trust than a collection of plugins. Whether Gneauxghts realizes that opportunity requires code inspection and user testing. [Obsidian Canvas](https://obsidian.md/help/plugins/canvas), [Smart Graph](https://smartconnections.app/smart-graph/), [Smart Connections FAQ](https://smartconnections.app/smart-connections/faq/).

## Do not conflate these mechanisms

| Mechanism | What proximity/grouping means | Best candidate job | Main cost or risk |
|---|---|---|---|
| Authored link graph | Someone wrote a reference | Trace context, inspect citations, navigate a known knowledge structure | No link means no relationship is shown; high-degree hubs obscure detail |
| Manually arranged board | Someone deliberately placed these items together | Compare, synthesize, plan, explain a project | Curation work and board maintenance |
| Embedding neighborhood | Text representations score similarly | Find related forgotten material around a note or question | Similarity is not importance, agreement, truth, or usefulness |
| Whole-corpus semantic landscape | An algorithm projected and clustered a corpus | Survey themes, discover regions, inspect outliers, build a working set | Layout distortion, changing clusters, hard-to-read titles, ambiguous geography |
| Generated concept tree | A model proposed a hierarchical summary | Learn the outline of a bounded set of sources | Hierarchy can invent or flatten relations; not necessarily a note organization system |
| Explicit collections, types, tags, saved queries | Authored metadata or rules establish membership | Repeated retrieval and bulk work on known categories | Up-front structure and metadata maintenance |
| Resurfacing queue | A policy selected items to reconsider now | Remember neglected material and build a review habit | Repetition fatigue; weak contextual relevance |

These are analytical distinctions, not a claim that any product implements only one mechanism. A sound Atlas design should identify which signals are inferred and which are authored instead of letting one graphic imply they are equivalent.

## Comparable implementations

### Obsidian native Graph and Canvas: two different tools

Graph shows note links, provides query filters and color groups, and offers a local graph centered on the active note with adjustable depth. Thus native Graph is already more than a decorative global view for someone who has built useful references. It does not automatically infer relatedness from unlinked prose. [Graph documentation](https://obsidian.md/help/plugins/graph).

Canvas supports note and media cards, labeled connections, editable groups, multi-selection, dragging whole folders onto a board, and editing notes in place. It stores layouts using the open JSON Canvas format. This already covers “interact with many notes at once” and deliberate idea organization; it requires the user to assemble the board. [Canvas documentation](https://obsidian.md/help/plugins/canvas).

**Critique/inference:** Native Graph's weakness for unlinked vaults does not establish Atlas's advantage over the full app. The relevant benchmark is how much work a user needs to turn an existing corpus into a useful, editable working set. Atlas should be compared against a filtered result list and a Canvas assembled from it, not just an unfiltered hairball.

### Smart Graph Pro and Smart Connections: the closest direct comparison

Smart Graph maps indexed notes by semantic similarity, supports whole-vault and smaller scopes, selectable semantic regions, source-note inspection, and an authored-link overlay. Its official documentation distinguishes generated bridges from authored links and calls regions, representatives, and affinities hypotheses rather than permanent categories. [Smart Graph documentation](https://smartconnections.app/docs/graph/).

Version 1.2 documents a readable Notes panel and conversion of a reviewed selection into Smart Context, an Obsidian Canvas, a source-linked note or synthesis note, copied links, or a PNG. It also describes retaining alternative embedding sets when changing models. [Smart Graph 1.2](https://smartconnections.app/smart-graph/releases/1-2/).

Smart Connections starts from the current note or block, offers a ranked readable list as its primary workflow, and treats the graph as an optional presentation. Its docs say passages, rather than scores, are the evidence to evaluate; Core retrieval uses local embeddings by default without an API key. [Connections workflow](https://smartconnections.app/docs/connections/), [privacy and setup FAQ](https://smartconnections.app/smart-connections/faq/).

**Critique/inference:** This directly implements much of the user's desired experience in the Obsidian ecosystem. “Semantic clusters plus multi-note actions” is feature parity, not defensible differentiation. Atlas's case must rest on faster onboarding, stronger interaction, simpler model behavior, better correction, privacy, and a cohesive app. A persistent similarity panel could deliver much of the discovery value with far less navigation overhead.

The setup comparison also limits the privacy claim. Smart Graph requires its Pro plugin and indexed sources in Smart Environment; the getting-started guide makes index readiness and source eligibility explicit. The Pro documentation says Graph shares a local performance index without an external vector database, while Core embeddings have an initial model-download/local-compute cost. “Local” is therefore shared territory; a bundled application can compete on removing plugin/account/model setup and explaining readiness more clearly. It must demonstrate this rather than assume competitors require cloud embeddings. [Graph setup](https://smartconnections.app/smart-graph/getting-started/), [Pro local architecture](https://smartconnections.app/community-supporters/), [local embedding tradeoffs](https://smartconnections.app/smart-connections/why-local-embeddings/).

### Chorographia: direct semantic atlas with an explicit stability mechanism

Chorographia's source repository describes UMAP projection, embedding-based zones and subzones, note-click navigation, a wikilink overlay, and a map lock that freezes positions, memberships, and names while placing new notes through nearest-neighbor interpolation. It saves complete map snapshots. Installation is currently documented via BRAT beta or manual files, with an Ollama local server as the default embedding provider and a 2,000-note default safety cap. [Source and README](https://github.com/teleologia/chorographia).

**Critique/inference:** Semantic note geography itself is clearly not unique. Map lock is an especially relevant design alternative when predictable spatial memory matters. Freezing preserves a learned landscape but can ossify obsolete categories, so it needs an intentional rebuild/comparison path. Its beta setup and external Ollama dependency leave potential room for easier onboarding; they do not demonstrate better Atlas usability or market demand.

### Heptabase: a thinking workspace built around actual material

Cards live in a shared card library; boards contain instances and a card can appear on several boards. Boards can have sections, sub-whiteboards, text, mind maps, arrows, and multi-selection. This explicitly supports different contexts for the same idea. Current docs also describe scoped AI chat with paragraph citations and saving or dragging an answer onto the board. [Fundamental elements](https://wiki.heptabase.com/fundamental-elements).

**Critique/inference:** Its strong candidate job is doing research and synthesis with content simultaneously visible, rather than mapping an entire archive. User curation conveys intent: “these are the materials for this argument.” Automatic clusters convey a weaker signal: “these texts resemble each other.” The design lesson is to let Atlas's inferred regions become durable, user-owned workspaces where one note can participate in more than one topic. Do not copy the full whiteboard feature set before proving that users need it.

### Scrintal: visual organization with docs, blocks, links, and boards

Scrintal's current homepage describes an infinite canvas containing PDFs, notes, videos, images, and nesting, with blocks, docs, arrows, bidirectional links, AI assistance, and real-time collaboration. [Current homepage](https://scrintal.com/). Its older link feature page describes drawing or typing bidirectional links and bringing linked items onto the canvas through a sidebar, but that page explicitly marks itself outdated; it should inform design history rather than be treated as current behavioral verification. [Older link page](https://scrintal.com/features/link-your-notes).

**Critique/inference:** Readable materials and deliberate relationships are the appeal. Its existence shows that spatial note manipulation is a recurring product idea, not that any particular automatic map is useful. Atlas should not inherit canvas interaction overhead—drawing arrows, arranging every card, maintaining layouts—unless those operations help a concrete writing or research job.

### Kosmik: visual collection and semantic retrieval

Official tutorials describe importing files onto a canvas, selected-item auto-layout, automatic tagging, tag-based search, and double-clicking a result to jump to its location. The web clipper documentation adds semantic search, OCR, visual similarity, and spatial arrangement of clipped material. [Tutorials](https://www.kosmik.app/tutorials), [web clipper workflow](https://www.kosmik.app/blog/kosmik-web-clipper).

**Critique/inference:** Kosmik illustrates a useful hybrid: automatically improve retrieval, while leaving visible project organization to the user. Atlas may gain more from search-and-reveal within a stable landscape than from reclustering everything during ordinary editing. Rich visual content helps a canvas earn its space; long Markdown notes represented as indistinguishable dots have a harder time doing so.

### Allume, formerly Muse: nested spatial workspaces

The official Muse URL now redirects to Allume. The current site emphasizes nested boards, text/ink/cards and media, an inbox, search and quick-jump, connections, local-first data, and constrained canvas interaction. It intentionally excludes complex formatting and endless canvas zooming. [Current Allume site](https://allume.com/).

**Critique/inference:** The useful idea is progressive containment: keep one manageable level of a project visible and descend into another board when necessary. This is a strong alternative to showing every note as a dot. Deliberate constraints can make spatial tools fast. It remains a manually constructed thinking environment, not evidence that an automatically embedded full-vault landscape works.

### Napkin: automatic topics and bounded rediscovery

Napkin's current support describes detecting topics from collected ideas, suggesting topics on opening, and exploring related ideas from a selected idea. [How Napkin works](https://support.napkin.one/en/articles/16730476-how-napkin-works), [related-idea flow](https://support.napkin.one/en/articles/16730487-how-can-i-see-related-ideas-to-a-recently-added-idea).

The current homepage says its desktop prototype shut down June 30, 2026, and its present focus is iPhone. It emphasizes text, concise collected ideas, and reflection, declines bulk note import, and does not position itself as an advanced writing tool. [Current Napkin site](https://napkin.one/).

**Critique/inference:** This is a reminder that “rediscover ideas” and “organize a mixed vault” are different products. A flow of a few concise items has a much smaller attention burden than deciphering a large map. Automatic semantic navigation is easiest to make compelling on short, deliberately selected material. The shutdown is evidence of a product transition, not evidence of failed demand; no causal market conclusion follows from it.

### Reflect: related notes beside the editor

Reflect's November 2023 release documented client-side embeddings, semantic search, and a similar-notes sidebar; the source establishes a historical implementation, not automatic continuity through later rewrites. [Historical release](https://reflect.app/blog/ai-search). Its current homepage advertises an open-source app with local Markdown, backlinks, iCloud or Git sync, and optional provider-backed AI. [Current homepage](https://reflect.app/).

**Critique/inference:** The historical interaction remains a strong alternative design: discover related material while working, without visiting a separate map. A topical overview need not compete with that surface; it could complement it. Avoid claiming today's precise semantic-sidebar behavior from a three-year-old release alone.

### Mem: just-in-time retrieval and flexible collections

Mem's current collaboration documentation says notes can belong to multiple collections and that Heads Up surfaces related team context when opening or starting notes. It also offers natural-language search and collection-scoped chat. [Current collaboration workflow](https://get.mem.ai/use-cases/collaboration). Its earlier Collections announcement describes suggested membership, recommendations for missing items, bulk additions, renaming, and merging. [Collections announcement](https://get.mem.ai/blog/automatic-organization-with-collections).

**Critique/inference:** Retrieval and multi-note work can exist without a global map. Mem's meaningful benchmark is “open the document for the work I am doing and receive useful past context,” which is easy for a user to evaluate. Atlas needs a similarly clear payoff. Automated grouping should permit accept/reject and flexible membership, not require users to repair a single imposed taxonomy.

### Readwise: rediscovery through an intentional review loop

Daily Review adjusts resurfacing probability after an item appears and allows source frequency tuning, similar-highlight exploration, and scheduled Themed Reviews. [Review behavior](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights). Current Themed Reviews can select material automatically from a described theme, show a preview, incorporate new documents, and deliver 1–15 highlights at a chosen frequency. [Themed Reviews](https://docs.readwise.io/readwise/guides/themed-reviews).

**Critique/inference:** If remembering neglected notes is the primary job, a small, tunable review queue is a credible stronger solution than an overview. It has an entry point, a finite session, and explicit feedback. “Nearby to something I just opened” mostly resurfaces more of the same; recency, neglect, novelty, and current goals should be independent controls. A map can offer exploration while a queue supports repeat use.

### NotebookLM / current Gemini Notebook docs: a source-bounded concept tree

Google's current help URL redirects to Gemini Notebook documentation. Mind Maps summarize uploaded sources as branching topics, support zoom and branch expansion, and let a node become a chat question. They can be revisited, regenerated, downloaded, and shared. The docs explicitly acknowledge possible inaccuracies. [Current Mind Maps help](https://support.google.com/gemininotebook/answer/16212283?hl=en).

**Critique/inference:** The scope is selected source material and its conceptual outline, rather than placing all durable notes into one taxonomy. A hierarchical topic browser may make a better default overview than a scatterplot because users can read and navigate labels immediately. A generated concept is not necessarily a note or a durable authored category; Atlas must preserve that distinction.

### Nomic Atlas: almost the same visual primitive, in a different market

Nomic Data Maps arrange a dataset by semantic similarity, use automatic hierarchical topic labels, and rebuild as data changes. Crucially, the docs say numerical 2D distances and axes have no concrete meaning; related clusters may be far apart and distinct clusters close. [Data Maps](https://docs.nomic.ai/atlas/datasets/data-maps).

Its controls include semantic and exact searches, metadata filters, lasso and individual selection, tagging selected items, three levels of topic coloring, label correction with prominent keywords, and alternative position modes. [Map controls](https://docs.nomic.ai/atlas/datasets/data-maps/controls). Selected regions and text queries can be combined by union or intersection, then tagged and exported. [Tagging guide](https://docs.nomic.ai/atlas/datasets/data-maps/guides/collaborative-tagging).

**Critique/inference:** This is the strongest operational model for “interact with lots of items”: map → inspect → refine selection → act → preserve results. Its dataset-analysis market makes population structure and outliers legitimate tasks. A personal writer needs a different justification for those same visual primitives. A lasso catches geography, so it should never silently mean “all semantically relevant notes.” The readable inspection/refinement step matters more than the lasso itself.

### InfraNodus: concept co-occurrence and analytical graph actions

The official Obsidian plugin repository describes extracting concepts and wikilinks, identifying clusters and central concepts, locating underlying content, and generating questions or ideas around selected concepts, topics, statements, or gaps. It creates relationships from concepts co-occurring in text; that is not the same mechanism as projecting a whole-note embedding. [Plugin source and README](https://github.com/noduslabs/infranodus-obsidian-plugin), [current first-graph tutorial](https://infranodus.com/tutorial/create-your-first-knowledge-graph).

**Critique/inference:** It offers specific operations beyond viewing, but terms such as “knowledge gap,” “influence,” or “blind spot” can overclaim what a text network measures. Two unconnected topics need not be connected; graph centrality is not intellectual importance. Atlas should learn from the actionability and inspectable source context while avoiding invented epistemic certainty.

### Capacities / Tana: organize by explicit structure rather than inferred geography

Capacities uses collections for curated groups within an object type and tags across object types. [Tags versus collections](https://docs.capacities.io/tutorials/tags-vs-collections). Tana's view documentation describes different views and field/name-based filtering over nodes. [Views](https://outliner.tana.inc/learn/features/views).

**Critique/inference:** Structured views deserve a place in the option set. For known projects, people, tasks, or sources, predictable filters and sortable lists can be more useful than similarity. Their cost is having to decide and maintain structure. Atlas's inferred discovery layer should complement authored organization, not make every organizational need a clustering problem.

### Small open-source implementations: evidence of accessibility, not demand

A current Obsidian 3D Semantic Graph repository documents UMAP/PCA projection, embedding-based k-means clusters, topic labels, semantic search, a neighbors sidebar, suggested links, duplicates, and per-cluster map-of-content generation. Its implementation caps pairwise insights at 3,000 embedded notes and caches embeddings/layouts. [Source repository](https://github.com/KHR0907/obsidian-3d-semantic-graph).

**Critique/inference:** The basic technical recipe is accessible enough to reproduce. A novel-looking renderer is unlikely to be a moat. The opportunity is product quality: stable behavior, speed on real messy vaults, clarity, recovery, useful actions, and evidence that people return. A small repository is not adoption evidence or proof of production readiness.

## What the competitive evidence supports—and does not

The parent investigation reports a concrete gap in current Atlas: its cloud inspector presents count/density/focus without a readable member list, and selection is single-note with no bulk operation. Treat that as app-audit evidence from the main investigation, not a finding independently reproduced in this comparison research. Against Smart Graph's documented reviewed sets and output actions, “interact with lots of notes at once” is currently an aspiration unless Atlas's main audit identifies other working paths. Seeing many dots simultaneously is not equivalent to reviewing or acting on many notes.

**Supported:** Multiple official products and public implementations offer authored spatial boards, semantic discovery, review flows, or combinations. The user's four desired benefits are plausible jobs and have close comparables.

**Not established:** How many users regularly use these specific views; whether they return after the first week; whether maps beat lists or related-note panels; whether discovering a surprising neighbor produces useful output; whether people would switch apps for Atlas; whether automatic grouping is accurate on mixed long-form vaults. Marketing testimonials, signups, “second brain” metaphors, screenshot appeal, and a current feature page do not answer those questions.

The comparison should make Atlas's own user tests harder, not substitute for them. Test against the least expensive useful alternative rather than against the weakest graph screenshot.

## Options worth testing, organized by job

These are design proposals and hypotheses, not findings about current app behavior.

| User job | Candidate surface | What to measure | What would invalidate the map-first bet |
|---|---|---|---|
| “Find what relates to what I am writing” | Related-note/passages sidebar | Relevant source found and reused; time and context switches | Sidebar matches or beats map with much lower interaction cost |
| “What is in my vault?” | Hierarchical topic cards with counts, examples, and drill-down | Correct understanding of corpus; ability to find a specific region | Readable cards beat dot geography on comprehension and speed |
| “Use many notes for this project” | Semantic search + checked list → saved collection/board | Review accuracy, useful working set, resulting synthesis | Lists give equally useful sets without pan/zoom/selection errors |
| “I forgot old ideas” | Finite review queue with neglected/related/novel modes | Useful rediscovery, return rate, dismissal quality | Queue produces more useful rediscoveries per minute |
| “Compare themes and inspect unexpected overlaps” | Map + source list + multi-membership/bridge view | Verified cross-topic connection leading to useful action | Users only inspect large obvious topical islands |
| “Clean up many notes” | Map or list selection + duplicate/outlier review | Correct decisions, preview comprehension, reversible actions | Geographic selection causes mistaken bulk operations |
| “Develop a line of thought” | User-curated content board with excerpts and explicit relations | New argument, plan, or artifact produced | Map does not expose enough actual content to support synthesis |
| “Organize known information reliably” | Tags, explicit groups, saved filters | Correct repeat retrieval after time has passed | Inferred groups shift enough to make them unreliable destinations |

Do not implement all these surfaces. Prototype two or three minimal competitors with the same notes, same retrieval engine, and same actions. This isolates the value of the map from the value of semantic indexing.

## Specific design lessons to carry into Atlas criticism

1. **Make the destination durable.** A user who validates a useful cluster should be able to save a reviewed set, board, or source-linked synthesis. Recomputed clustering should not rewrite that decision.
2. **Support overlapping themes.** “Creativity,” “education,” and “career change” may all describe the same note. One exclusive cluster is a display simplification, not its meaning.
3. **Show source evidence.** Titles, excerpts, note identities, membership explanations, and context let users judge a grouping. A confident label over anonymous dots does not.
4. **Keep inference separate from authorship.** Proximity, generated bridge, explicit link, user group, and suggested topic need visibly different meanings.
5. **Do not make geography the only selector.** Topic clicks, textual searches, checked lists, and saved filters need to work alongside area selection; users should inspect exactly what is selected before acting.
6. **Scope early and preserve context.** A local neighborhood or project subset is often a better entry than the whole vault. Show where it came from and make going back cheap.
7. **Prioritize readable content over edge density.** Seeing many notes at once is not seeing what those notes say. A map with a readable source panel or zoomed excerpt cards is more plausible for synthesis.
8. **Correctability is part of the core interaction.** Rename labels, exclude notes, preserve multi-membership, and distinguish a one-time override from feedback that influences future grouping.
9. **Stability and novelty are in tension.** A good discovery map can change with new data; a good navigational map is predictable. Make refreshes and stable saved views understandable instead of pretending the conflict disappears.
10. **Judge value by useful work.** Ask whether users found and used forgotten material, chose a better working set, organized correctly, or produced something. Pan/zoom time and “looks cool” are weak success signals.

## Suggested primary-source shortlist for the main report

- Direct competitor and trust model: [Smart Graph docs](https://smartconnections.app/docs/graph/) and [Smart Graph 1.2 actions](https://smartconnections.app/smart-graph/releases/1-2/).
- Fair Obsidian comparison: [native Canvas](https://obsidian.md/help/plugins/canvas).
- Multi-context note instances: [Heptabase elements](https://wiki.heptabase.com/fundamental-elements).
- Most similar semantic map interaction and projection limitation: [Nomic Data Maps](https://docs.nomic.ai/atlas/datasets/data-maps) and [controls](https://docs.nomic.ai/atlas/datasets/data-maps/controls).
- Strongest alternative for remembering: [Readwise Themed Reviews](https://docs.readwise.io/readwise/guides/themed-reviews).
- Strongest low-friction related-note competitor: [Smart Connections](https://smartconnections.app/docs/connections/).

No app code was modified.
