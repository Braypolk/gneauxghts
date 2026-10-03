# Atlas: critical product assessment

October 2, 2026. Research and recommendation, not a commitment to implement. No application code changed.

## Judgment

**Keep the automatic discovery capability. Change the default interaction before investing further in map sophistication.** Atlas has a credible audience and a useful underlying problem, but its current whole-vault map is not yet a compelling tool for working with many notes. It is an attractive automatic topic browser with limited follow-through.

The strongest product promise is: **“Recover useful past thinking and turn it into a working set, without organizing your whole vault first.”** That promise can justify a map, readable topic shelves, local neighborhoods, or several cooperating views. Do not make the map itself the promise until it beats alternatives with the same semantic intelligence.

My recommendation is a hybrid: an optional overview, readable topic contents, focused local exploration, and a reviewed selection that can become a saved set of sources. Preserve the map's emotional appeal and easy exploration, but give users a fast path from discovery to reading and doing something useful.

This is a conditional product judgment. The research establishes plausible mechanisms, competitors, and risks. It does **not** establish demand, retention, willingness to switch note apps, or willingness to pay. No users were recruited or interviewed during this investigation.

## Basis and reading order

1. [Implementation audit](implementation.md): actual pipeline and current UI capabilities, with code references and live-observation limits.
2. [Comparable implementations](comparables.md): 15 comparable product/implementation approaches, distinguishing semantic maps, authored graphs, boards, trees, collections, and review flows.
3. [Empirical evidence](evidence.md): 13 evidence sections with study tasks, samples, limitations, and experimental proposals.

I inspected current source and the running installed app. The installed app's build was not matched to the checkout, so source inspection and live observations are identified separately. I browsed first-party documentation, repositories, and original papers; did not infer success from vendor testimonials or product existence. This covers the principal design families and close competitors, not every product or conceivable interaction.

## What Atlas actually is

Notes are chunked and embedded locally. Chunk embeddings are averaged into a note vector. Nearest neighbors and wikilinks produce a graph, which is partitioned into communities and subcommunities. UMAP provides coordinates, then the layout compacts and repacks groups into separated clouds. Extractive content labels arrive progressively. Search highlights existing locations; zoom reveals more titles and selected relationships. Source: [implementation audit](implementation.md).

That is substantially more purposeful than a raw global backlink graph. Existing choices worth keeping include optional tags, local computation, semantic and authored links as separate kinds, sparse overview links, progressive labeling, and serving a usable previous map while replacement work runs.

However, the visible clouds are inferred proposals. They are not durable user-owned organization. The current route offers one selected note, a short preview and related-note list, or a selected cloud with count/density/focus. It has no member list, multi-select, selection basket, or action on a set of notes. The map can reveal many notes but does not yet support effective work on many notes.

## The four benefits, examined critically

| Desired benefit | What I agree with | Where the current concept falls short | Stronger expression |
| --- | --- | --- | --- |
| Organize notes by ideas | Automatic grouping reduces the need to pre-link or file notes | Topical resemblance is only one kind of relationship; names/membership cannot be corrected or preserved | Suggested topics with examples, overlap, corrections, and saved reviewed sets |
| Interact with many notes | A spatial overview can reveal distribution and neighborhoods | Many visible dots do not expose enough content to compare or select; current actions remain singular | Readable members and excerpts, multi-select, compare/collect/open selected sources |
| Explore and remember | Browsing by recognition can recover things a query would miss | Strong similarity favors familiar material; nothing currently guarantees neglected notes or useful novelty | Related/older/different-angle choices with context and a concrete reuse action |
| Move quickly | Few controls and automatic setup choices reduce visible complexity | Hidden titles, zooming, ambiguous labels, and leaving the map to read impose work despite a simple toolbar | One click to readable contents; keyboard/list navigation; preserved camera and return trail |

These are not four versions of one task. Finding an old decision, surveying a vault, organizing a project, and writing an argument need different information and different success measures.

“Simple enough” should mean **few steps to a useful result**, not few controls. A map with almost no controls can still be slow if the user must decode dots, pan around, and inspect notes serially.

## The most consequential criticisms

### 1. The promised bulk interaction is missing

The immediate priority should be clicking a cloud and seeing readable members, representative excerpts, and optional related material outside its boundary. Users should be able to check or uncheck notes and save a reviewed set. Geographic selection alone should not decide what belongs: it needs the same reviewable list.

The rival benchmark is already concrete. Smart Graph documents semantic regions and a Notes panel, with selected sources convertible to context, Canvas, or source-linked notes. A similar capability in Atlas would close a gap, not create a unique feature. [Smart Graph release](https://smartconnections.app/smart-graph/releases/1-2/).

### 2. Algorithmic grouping does not necessarily match the user's ideas

An embedding typically tells you which texts resemble one another. It cannot establish that one note supports another, contradicts it, explains it, or matters to the current project. A note about preparing a technical talk could belong to writing, career, a work project, teaching, and presentation design. A single primary cloud is a visual simplification.

Users may want notes grouped around a question or action rather than a subject noun. “Prepare my talk” is often more useful than “communication.” Topic grouping is a useful starting point; meaningful organization needs user intent.

A missed opportunity is exploring overlaps instead of only separated islands. Let users inspect “also related to,” shared passages, or an alternative lens. Do not automatically generate asserted causal/contradictory relationships without inspectable evidence and appropriate review.

### 3. Spatial memory needs dependable geography

Atlas caches coordinates, but rebuilds optimize and repack clouds. Ordinal cloud IDs and ID-derived colors can change their meaning as ranked groups change. Maintaining the same string selection across a rebuild does not prove it refers to the same topic. This deserves attention before users learn locations. Source: implementation audit.

Possible policies include placing new notes into stable regions, preserving landmarks and matching clusters by overlap, limiting movement of unchanged notes, or offering an explicit regroup preview. A locked map preserves memory but can retain obsolete groups; an always-current map can discard memory. Make the tradeoff intentional.

Chorographia already documents map lock and saved snapshots. These are worth examining as alternatives, not proof that freezing is always better. [Chorographia repository](https://github.com/teleologia/chorographia).

### 4. The interface overstates what its numbers mean

“Importance” is calculated from graph connectivity. Semantic percentages come from rescaled edge strength with structural boosts. Neither is calibrated probability or user value. Cloud density has no demonstrated user decision attached to it. These precise numbers can make the feature feel scientific while communicating the wrong thing.

Prefer source excerpts and plain relationship descriptions. An explicitly authored link and an inferred similar passage should look different. If connectivity helps identify overview representatives, keep that internal rather than presenting it as a verdict on a person's thinking.

### 5. Geography looks more meaningful than it is

Atlas's island packing deliberately changes screen distances. That is reasonable for readability; it weakens any literal interpretation of semantic geography. Nomic explicitly cautions that 2D axes/distances lack concrete meaning and inter-cluster proximity can mislead. Atlas should likewise make relationship evidence accessible and avoid teaching users to interpret empty space as intellectual difference. [Nomic Data Maps](https://docs.nomic.ai/atlas/datasets/data-maps).

Do not fix this with a permanently visible technical disclaimer. Fix the interaction: local relatedness verified against the original representation, distinct authored links, useful snippets, and narrower scopes where the map's interpretation is clearer.

### 6. Content is too expensive to inspect

The running overview displayed topic words and anonymous dots. Zoom exposed overlapping/truncated titles. Search dimmed nonmatches but retained prominent lines, and useful results could remain outside the viewport. This makes it possible to spend time navigating without gaining much understanding.

A cloud's readable list, ranked search results, match count, jump-to-result, and a peek at content would have more practical value than another layer of graph decoration. A list/tree also provides an equivalent keyboard and assistive-technology path.

### 7. Whole-note representation may erase the useful detail

Averaging chunks is economical, but mixed journals and meeting notes contain several topics. A note can land in the right general cloud while the passage relevant to today's work remains invisible. Showing every chunk on the global map would create a different overload problem. Start by exposing matching passages and secondary memberships inside a readable detail view.

### 8. The feature may be liked without becoming a habit

Personal landscapes can feel delightful and evoke ownership; those are legitimate values. But appreciation does not establish that the map saves time or improves work. Repeatedly seeing obvious topic islands may cease to be informative. Conversely, a valuable weekly review tool need not be opened every day.

Measure whether users return when a relevant task arises and reuse material they would otherwise miss. Do not judge solely by map open count, time spent, or lack of daily use.

## Would people actually want it?

**Some users plausibly would. The audience is narrower and more task-specific than “people who take notes.”** These are hypotheses to recruit/test, not observed market segments.

| Candidate audience | Why it could work | What might make it fail |
| --- | --- | --- |
| Writers/researchers with substantial old material | Recover evidence and assemble source sets | Dots do not show passages; similar material crowds out different arguments |
| People with a large, poorly linked vault | Automatic structure without a cleanup project | Low-quality capture/templates produce misleading groups; setup too slow |
| Project-heavy professionals | Recover old decisions/context for current work | Their useful relationships are person/project/time rather than topic |
| Reflective journal/idea collectors | Recognition and prompted rediscovery | Mixed notes, sensitive material, superficial recurring topics |
| Visual thinkers | Overview and spatial ownership | Automatic movement conflicts with personal placement |
| Casual note users | Occasional interesting overview | Small corpus and ordinary search leave little unmet need |

The hardest commercial question is whether this is enough reason to adopt an entire note app. A plugin user already has storage, capture habits, and years of working organization. Atlas must overcome that switching cost with the whole product, not merely a better screenshot.

A promising initial audience is people whose archive has outgrown their memory and who repeatedly produce work from past notes. That formulation captures a recurring pain without assuming every person wants a map.

## What the empirical research supports

The evidence is mixed and usually narrower than product claims:

- **Stable spatial placement:** Data Mountain found retrieval benefits on a supplied 100-page corpus. Participants arranged their own material; the comparator was Internet Explorer 4 favorites. It supports spatial-memory plausibility, not superiority of automatic Atlas over modern search. [Original paper](https://www.microsoft.com/en-us/research/wp-content/uploads/1998/01/p153-robertson.pdf).
- **Focused relationships:** a 40-student investigation task improved clue/relationship detection with visualization. The 80% versus 40% solution difference was only borderline statistically significant, so it should not be advertised as a proven doubling. The graph represented relevant shared entities in a bounded task. [Original paper](https://sfussell.hci.cornell.edu/pubs/Manuscripts/p2721-goyal.pdf).
- **Field use is uneven:** Information Collage's month-long invitation to 18 people yielded eight reported actual-task users. Its iterations removed cluttered links, and automatic labels sometimes failed. Some users nevertheless wanted automatic organization instead of manual placement. This favors testing automation plus readable material, with modest expectations about uptake. [Technical report](https://visvar.github.io/assets/pdf/sippl2019tr.pdf).
- **Context helps finding:** observational refinding research describes people navigating from remembered contexts rather than specifying a perfect query. A useful neighborhood might be a project/person/time context, not necessarily a 2D location. [Orienteering study](https://people.csail.mit.edu/teevan/work/publications/papers/chi04.pdf).

The evidence ledger covers more studies and limitations. None establishes Atlas demand or paid retention. Absence of that proof does not make the feature bad; it determines what should be tested next.

## The competitive landscape

The detailed comparison covers Obsidian Graph/Canvas, Smart Graph/Connections, Chorographia, Heptabase, Scrintal, Kosmik, Allume/Muse, Napkin, Reflect, Mem, Readwise, NotebookLM/Gemini Notebook mind maps, Nomic, InfraNodus, and explicit-structure approaches in Capacities/Tana. Historical releases are marked separately from current documentation.

The most consequential benchmarks:

| Benchmark | What Atlas should learn | Differentiation consequence |
| --- | --- | --- |
| Smart Graph | Semantic overview must lead to readable reviewed sources and useful outputs | Semantic clusters with bulk actions already exist in Obsidian |
| Chorographia | Stable views and explicit rebuild/snapshot policies | Semantic note geography is already directly implemented |
| Heptabase / native Canvas | Reading, arranging, and synthesizing actual content | “Many notes at once” competes with boards, not only graphs |
| Smart Connections | Discovery beside the current note | A sidebar can deliver value with fewer context switches |
| Nomic | Select, inspect, refine, act, preserve | A map's operational loop matters more than its appearance |
| Readwise | A finite, relevant review session | Remembering can be solved without a map |

Additional relevant implementations are seeded literature maps. Connected Papers builds a similarity neighborhood from a chosen paper using citation-based similarities; Litmaps follows citation/reference networks from starting articles. These narrow discovery to a recognizable task and corpus. Their graphs are not evidence for a whole personal-vault map. [Connected Papers explanation](https://www.connectedpapers.com/about), [Litmaps algorithms](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps).

Local-first is valuable but shared with competitors. The viable advantage is an integrated, approachable workflow: setup, readiness, useful grouping, source inspection, corrections, and handoff to ordinary writing. It must be demonstrated rather than assumed.

## The option space

Treat these as alternatives to evaluate, not a backlog to implement wholesale. They differ along five dimensions: whole-vault versus task scope; algorithm versus user authorship; dots versus readable content; changing versus stable placement; discovery versus durable output.

| Option | Best job | Main advantage | Main compromise | Priority |
| --- | --- | --- | --- | --- |
| Current semantic island map | Survey and open exploration | Broad topic shape with little curation | Hidden content, unstable geography | Keep as baseline |
| Topic shelves with excerpts | Browse ideas without knowing a query | Immediate reading, counts, selection | Less spatial overview; labels remain fallible | Test first |
| Map with linked member list | Explore and build a working set | Preserves overview while making action legible | Two synchronized views | Test first |
| Local note neighborhood | Follow context while reading/writing | Bounded choices and a concrete anchor | Can miss distant material | Test first |
| Grouped semantic search | Find by partial idea | Ranked previews; faster focused retrieval | Requires a query | Strong baseline |
| Saved query/faceted lens | Repeat project/person/time retrieval | Multiple perspectives without moving files | Filter complexity | Add only for proven repeat jobs |
| Reviewed saved collection | Preserve discovered material | Durable membership independent of future clustering | Membership upkeep | Core downstream action |
| User-curated excerpt board | Compare/synthesize | Visible evidence and authored relations | Manual layout/maintenance | Test after working-set value |
| Nested boards/topic tree | Navigate large corpora | Readable progressive scope | Forces a hierarchy | Compare with shelves |
| Finite rediscovery queue | Remember useful neglected notes | Low-effort, bounded session | Repetition and weak relevance | Test if recall is main pain |
| Timeline/project activity view | Recover context and prior work | Dates/people/events may be memorable | Topic relationships less obvious | Segment-specific |
| Topic-by-time matrix | Notice changes in interest/work | Explicit axes and trends | Less useful for reading individual notes | Later diagnostic option |
| Overlap/bridge view | Find material spanning themes | Exposes cross-topic possibilities | False bridges need evidence | Narrow experiment |
| Source-linked outline | Turn notes into an argument/plan | Direct useful output | Less open-ended discovery | Strong synthesis comparator |
| Duplicate/outlier review | Vault cleanup | Clear finite decisions | Risk of equating unusual with unwanted | Separate job; reversible review |
| Query-based generated concept tree | Understand a bounded source set | Readable overview/questions | Invented hierarchy/summaries | Test only with source grounding |
| Stable semantic map with proposed updates | Long-term geographic navigation | Protects memory | Stale placement/change management | Test stability policy |
| 3D/VR graph | Immersive exploration | More presentation space | Occlusion/navigation/accessibility burden | Defer absent evidence |

A matrix or timeline is not universally “better.” It is better only when its axes reflect the task. A board is not automatically better either: manual curation can recreate the maintenance burden automatic grouping was supposed to remove.

## Recommended smallest coherent direction

Build a testable interaction around this example: **“I am returning to a stalled project. Show me what I already thought, let me choose the useful material, and help me resume.”**

1. Enter from a topic, query, or active note. Keep the broad map available.
2. Immediately see a readable scoped set, with titles, relevant excerpts, and exact source identity.
3. Add/remove sources from a visible selection. Suggest optional older material or a different angle separately.
4. Save the reviewed set or open it in the existing workspace. If synthesis is offered, retain source links and user review.
5. Return to the same scope/viewport and selection after reading a source.

This creates a purposeful loop without requiring a full infinite-canvas editor. The app already has notes, panes, tags, and related-note retrieval; reuse those capabilities and their existing owners rather than introducing a competing persistence path.

Early priorities are readable members, selection, source evidence, returning to context, and honest labels. Stability and overlap follow. Expensive generative naming, dozens of map parameters, 3D, elaborate terrain, and automatic permanent linking should wait.

Changing tag filters to regroup the map would reopen an explicit current behavior invariant. If a future design needs alternate groupings, make them a distinct lens with a clear transition; do not silently replace the existing highlight-in-place contract.

## How to determine whether the map earns its place

Start with 12–16 exploratory participants using real notes and real tasks. Include lapsed graph users, low-link vaults, focused versus mixed notes, different languages, and small versus large archives. This sample diagnoses usability and segments; it is not a statistically powered market study.

Compare three minimal variants: current map, topic shelves, and map-plus-readable-members/local scope. Give them the same semantic retrieval, labels, previews, and set actions. Otherwise the trial confounds layout with improved intelligence.

Ask participants to recover an old known note, find neglected useful material for an actual project, choose sources for a brief, and produce that brief. Counterbalance variant order and use matched different tasks to reduce learning effects. Evaluate:

- Successful finding and time to useful content.
- Unexpected **and useful** material, followed by actual reuse a week later.
- Quality and completeness of the selected set and resulting work.
- Wrong inclusions, unsupported connections, and correction burden.
- Ability to resume after opening a source and after corpus changes.
- Voluntary return over four to six weeks and what abandoners used instead.
- Cold/warm readiness, indexing latency, frame time, and memory on representative hardware.

Choose decision rules before trials. Keep the map primary if it improves useful discovery/comprehension or yields strong segment preference without hurting task success. Make it optional if shelves do the daily work better but overview is valued. Reduce investment if its incremental benefit disappears when competing views share the same semantic engine.

For stability, measure both coordinate/membership churn and task degradation after realistic edits/additions. For recommendations, measure relevance/diversity and repeated dismissals. Neither a mathematically good projection nor high click count substitutes for user outcomes.

## Final recommendation

Atlas deserves a focused next experiment. Its useful foundation is automatic access to neglected thinking; its current weakness is turning that access into readable, deliberate work. The best near-term bet is **map → readable notes → reviewed set → useful output**, compared fairly with a non-map topic browser.

Do not abandon the appeal of exploring a personal landscape. Earn the right to make it central by showing that people can accomplish something important through it with less effort than the alternatives.
