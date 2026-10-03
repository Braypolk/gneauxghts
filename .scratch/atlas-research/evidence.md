# Atlas: empirical evidence and proposed validation

Research date: 2026-10-02. Scope: primary empirical research about spatial organization, refinding, sensemaking, serendipity, and semantic-map interpretation. This file does not claim to inspect the Atlas implementation; implementation-specific conclusions belong in the accompanying audit. Recommendations below are design inferences, not established facts about Atlas users.

## Verdict

There is a credible human need behind Atlas: recovering ideas, seeing multiple notes together, and forming meaningful groups. There is considerably weaker evidence that a whole-vault semantic map is the best interface for those jobs. The most relevant positive spatial-memory results concern **stable layouts created by the user**, rather than automatic layouts that reorganize as content changes. Whole-vault overview, bulk organization, refinding, and developing an argument are different tasks and may need different representations.

The correct claim is “a promising interface that deserves task-based trials,” not “research shows users will love this.” None of the sources reviewed demonstrates consumer note-app retention, willingness to pay for maps, or that a map wins against modern search plus grouped readable cards. Product demos and favorable comments cannot establish those outcomes.

## Evidence ledger

### 1. Stable spatial layouts can support refinding

[Robertson et al., Data Mountain, UIST 1998, original Microsoft Research paper](https://www.microsoft.com/en-us/research/wp-content/uploads/1998/01/p153-robertson.pdf).

- Study: 32 experienced Internet Explorer 4 users, ages 18–50, arranged and retrieved 100 supplied web-page snapshots. Three groups compared IE4 Favorites with two versions of a spatial thumbnail interface. Users chose their own organization; retrieval happened after a short break.
- Finding: Data Mountain facilitated faster retrieval overall; its revised version also reduced incorrect selections. The interface bundled spatial placement, thumbnails, immediate title display, collision handling, audio, and substantially more screen space than the comparator.
- Limit: this does not isolate “spatialness,” establish automatic semantic layout benefits, test a changing personal vault, or beat contemporary search. The authors explicitly identify those component contributions as unresolved.
- Atlas inference: stable locations, recognizable landmarks, readable previews, and preventing occlusion are plausible requirements. Calling a layout a map does not give it the same benefit when users did not construct it or cannot rely on its location.

### 2. The same layout can remain memorable after months

[Czerwinski et al., The Contribution of Thumbnail Image, Mouse-over Text and Spatial Location Memory to Web Page Retrieval in 3D, INTERACT 1999](https://www.microsoft.com/en-us/research/wp-content/uploads/1999/01/interact99.pdf).

- Study: nine returning participants, approximately six months after creating their individual 100-page layouts and roughly four months after their last interaction with them. They received five minutes to review the old layout; half the trials replaced thumbnails with blank rectangles.
- Finding: no statistically reliable loss in retrieval speed between immediate and delayed retrieval. Removing thumbnails initially harmed performance, but participants adapted rapidly.
- Limit: a small returning sample, the same already-trained corpus and layout, and a brief refresher. A nonsignificant difference is not proof of equivalence; this is not a natural-use retention study.
- Atlas inference: protect continuity. A map that remakes its geography every time the corpus grows may discard exactly the advantage this research suggests.

### 3. Semantic recommendations layered onto a map did not establish a retrieval win

[Czerwinski et al., Visualizing Implicit Queries for Information Management and Retrieval, CHI 1999](https://www.microsoft.com/en-us/research/wp-content/uploads/1999/01/p560-czerwinski.pdf).

- Study: 35 intermediate web users organized 100 supplied pages. Related pages were highlighted using either previous participants' groupings or a content-vector similarity calculation, compared with no highlighting; retrieval was a second phase.
- Finding: recommendation conditions produced somewhat more categories and faster retrieval, but the principal differences were not statistically significant. The paper reports a significant category difference only after pooling with another condition.
- Distinction: semantic similarity highlighted a **user-controlled, spatially consistent layout**. It did not automatically place everything according to similarity.
- Atlas inference: separate the benefit of relevance suggestions from the benefit of their visual arrangement. A related-notes panel could capture much of the benefit with less map navigation. Treat “AI grouping + map” as two independently testable features.

### 4. The closest field study shows both promise and weak uptake

[Sippl, Sedlmair and Waldner, Collecting and Structuring Information in the Information Collage, technical report, 2019](https://visvar.github.io/assets/pdf/sippl2019tr.pdf).

- Design: browser extension with manual spatial arrangement, text analysis, semantic zoom, and similarity exploration. Four knowledge workers did case studies; 18 computer-science volunteers were invited to use it for one month.
- Uptake: 14 provided feedback; three did not use it and three only played with it, leaving eight actual-task users.
- Findings: links/term boxes were removed for clutter even in sparse collages; automatic keywords sometimes failed, prompting manual labels. Conversely, shoebox users often considered manual arrangement needless overhead; some requested automatic content organization and reading/filtering inside the collection. This is favorable qualitative evidence for Atlas's automation, not proof that map geometry is necessary.
- Limit: small selected sample, iterative prototypes, technical report, no randomized comparator. Technical friction also affected usage.
- Atlas inference: support both automatic views and user corrections; prioritize legible content and low maintenance. Test voluntary return and useful work.

### 5. A graph can improve a real reasoning task—when the relationships matter to that task

[Goyal, Leshed and Fussell, Effects of Visualization and Note-Taking on Sensemaking and Analysis, CHI 2013](https://sfussell.hci.cornell.edu/pubs/Manuscripts/p2721-goyal.pdf).

- Study: 40 U.S. students, randomized across four conditions, solved a one-hour homicide-analysis task using 30 constructed documents and 56 possible suspects. The visualization linked documents sharing entities with the active document; the other manipulated feature was a notepad.
- Finding: visualization improved clue detection (4.2 versus 1.7 clues, p<.001) and relationship detection (p=.001). Killer identification was 80% versus 40%, but its logistic-model effect was only borderline (p=.07), not significant at .05. The notepad added no statistically supported performance benefit despite favorable ratings; the combination added no demonstrated benefit over visualization alone.
- Limit: a designed puzzle with planted cross-document evidence; students, a large monitor, one hour, ten people per condition. The graph was a focused view of shared entities, not an unrestricted whole-vault semantic constellation.
- Atlas inference: strongest argument for a local map is a concrete question requiring cross-note connections. Self-reported usefulness is insufficient; measure the quality of the resulting synthesis.

### 6. Spatial organization can be informal instead of a forced taxonomy

[Marshall and Shipman, Searching for the Missing Link: Discovering Implicit Structure in Spatial Hypertext, Hypertext 1993, author-hosted full text](https://people.engr.tamu.edu/shipman/viki/papers/ht93/ht93.html).

- Evidence: analysis of eight spatialized-text samples from three systems, produced in long-term information management or analysis work. Authors observed arrangements using position, visual style, recurrence, and implicit groupings.
- Design insight: people may have difficulty specifying why two things should be formally linked; loose proximity permits tentative and ambiguous relationships. Spatial structures can support grouping and later formalization.
- Limit: qualitative examples and recognition algorithms, not a controlled performance or adoption trial.
- Atlas inference: let a note belong to multiple perspectives; preserve tentative relationships. Do not convert every neighboring note into an asserted semantic link or every cluster into a definitive category. “Explore,” “collect,” and “commit organization” should have different consequences.

### 7. Graph superiority is task- and density-dependent

[Ghoniem, Fekete and Castagliola, A Comparison of the Readability of Graphs Using Node-Link and Matrix-Based Representations, InfoVis 2004, original paper](https://courses.ischool.berkeley.edu/i247/f05/readings/Ghoniem-GraphReadability_InfoVis04.pdf).

- Study: 36 computer-science postgraduate students/researchers used random undirected graphs with 20, 50, or 100 nodes and densities 0.2, 0.4, or 0.6 for graph-reading tasks.
- Finding: node-link diagrams suited small graphs; matrices suited larger/dense graphs for several tasks. Path tasks remained difficult and benefited from explicit interaction.
- Limit: artificial graphs and low-level structural tasks, not notes or semantic-map exploration. The widely repeated “20 nodes” threshold is not a universal design law; it does not directly apply to an edgeless semantic scatterplot.
- Atlas inference: a general graph is not automatically a good bulk interface. Choose representation by task and use focused subsets. For comparing text, grouped lists/cards may be better than either graph or matrix; that comparison still needs testing.

### 8. Users often find through recognizable context, not a perfect query

[Teevan et al., The Perfect Search Engine Is Not Enough: A Study of Orienteering Behavior in Directed Search, CHI 2004](https://people.csail.mit.edu/teevan/work/publications/papers/chi04.pdf).

- Study: 15 MIT computer-science graduate students, repeatedly interviewed during five workdays, with direct observation and longer interviews. The authors characterize the results as exploratory and qualitative.
- Finding: people often approached a known source/context first and then navigated locally, rather than specifying the final answer directly. Metadata and remembered context supported this process.
- Limit: expert computer users, older tools, reported incidents rather than a randomized test. This does not establish a spatial interface advantage.
- Atlas inference: “take me to the neighborhood” is credible, but a neighborhood can also be a project, date range, person, source, or an editable collection. Preserve those cues alongside semantic similarity.

### 9. Organization can cost more than it returns

[Whittaker et al., Am I Wasting My Time Organizing Email? A Study of Email Refinding, CHI 2011, IBM Research publication](https://research.ibm.com/publications/am-i-wasting-my-time-organizing-email-a-study-of-email-refinding).

- Study: instrumented email client with search, folders, tags, and threading; 345 long-term users and more than 85,000 refinding actions.
- Finding: elaborate preparatory filing did not improve refinding success and was inefficient. Search and threading supported more effective finding; scrolling was the most common refinding behavior.
- Limit: email has senders, dates, subjects, and threads; it is not identical to authored notes. Do not generalize to “all organization is useless.”
- Atlas inference: bulk organization is valuable only when its downstream payoff exceeds its maintenance cost. Measure organization time plus later reuse, rather than praising the number of groups created or notes moved.

### 10. Strong non-map retrieval is an essential comparator

[Dumais et al., Stuff I've Seen: A System for Personal Information Retrieval and Re-Use, SIGIR 2003, Microsoft Research](https://www.microsoft.com/en-us/research/publication/stuff-ive-seen-a-system-for-personal-information-retrieval-and-re-use/).

- Evidence: an internally deployed unified personal-information search tool used by more than 230 employees; qualitative and quantitative evaluation emphasized time and people as retrieval cues.
- Finding: users reported easier finding and used other search tools less after installation.
- Limit: workplace deployment and early search technology; not a direct map comparison or modern-note retention study.
- Atlas inference: automatic idea groups should compete against readable search results with semantic retrieval, contextual filters, and previews. Comparing only against Obsidian's unconfigured global graph would be an undemanding benchmark.

### 11. There is still a refinding problem, but needs are heterogeneous

[Managing Personal Information: Tactics, Strategies, and Outcomes, Interacting with Computers, online publication 2025](https://academic.oup.com/iwc/article/38/5/774/8377849).

- Study: questionnaire responses from 51 participants across resource types, yielding 326 usable participant/resource records for cluster analysis.
- Finding: users report moderate success/satisfaction and worse outcomes reusing older resources than finding active ones. The paper identifies differing combinations of management tactics rather than a single ideal organizing strategy.
- Limit: self-report and an exploratory sample; correlations do not establish that particular tactics cause success. Some supporting controlled retrieval studies are much older and concern other resources.
- Atlas inference: old-note recovery is worth targeting. Avoid designing only for meticulous organizers or assuming all users enjoy maintaining a map. The most revealing segment may be people whose vault outgrew their ability to remember it, who still need specific work outcomes.

### 12. Projection geometry can create an illusion of certainty

[Jeon et al., Stop Misusing t-SNE and UMAP for Visual Analytics, latest July 2026 version](https://arxiv.org/abs/2506.08725).

- Evidence: the latest version reviews 136 papers, interviews dimensionality-reduction users, and interviews experts. Its metadata lists IEEE VIS 2026/TVCG. Earlier search snippets describe the 2025 version and 114 papers; use the updated count.
- Finding: analysts often misuse projected inter-cluster distances as evidence of original-data relationships. Limited understanding of dimensionality reduction contributes to the problem.
- Limit: about visual analysis of dimensionality reduction, not Atlas specifically. These risks apply only if its geometry derives from such projection; inspect the actual algorithm before asserting a defect.
- Atlas inference: “near on the screen” must not silently mean “strong intellectual relationship.” Test neighbors in the original semantic representation; show relationship evidence on request. Cluster borders and precise labels must not imply certainty the model has not earned.

[UMAP project documentation: reproducibility](https://umap-learn.readthedocs.io/en/latest/reproducibility.html).

- UMAP is stochastic. Fixing a seed can reproduce the same input/configuration, with performance tradeoffs for some parallel execution. This does not by itself guarantee stable positions after the input corpus changes.
- Atlas inference: test stability under adding, editing, deleting, and re-embedding notes. Random-seed determinism and a stable navigational mental model are distinct requirements. Applicability depends on the actual Atlas layout implementation.

### 13. Serendipity needs value and context, not just unusual adjacency

[What Is Serendipity? An Interview Study to Conceptualize Experienced Serendipity in Recommender Systems, UMAP conference 2025](https://doi.org/10.1145/3699682.3728325).

- Evidence: in-depth interviews with frequent recommender users. Reported experiences included both broadening tastes and deepening existing interests; unusual recommendations were valued when intriguing/enriching, rather than unusualness alone.
- Limit: qualitative accounts of online recommendations, not measured note reuse; the full DOI fetch was blocked, so this reading uses the primary publisher's indexed abstract/text, without claiming unverified sample or effect size.
- Atlas inference: measure “unexpected and useful for something I care about,” including follow-through. Mere surprise, clicks, and dwell time are insufficient. Related forgotten notes can be useful without being maximally distant or strange.

[Goldstein and Carbonell, Summarization: Using MMR for Diversity-Based Reranking, 1998, ACL Anthology](https://aclanthology.org/X98-1025/).

- The original approach balances relevance with avoiding redundancy in a ranked selection.
- Atlas inference: semantic neighbors can be diversified without committing to a 2D map. A small “related / older / different angle” shelf is a serious alternative, though this paper does not validate that proposed interface for notes.

## Tough implications for product direction

These are hypotheses and recommendations derived from the evidence, not findings proven in Gneauxghts.

1. **Clustering is not organizing.** A model assigning notes to clusters creates a proposed view. Useful organization also requires legible names, the user's ability to correct placement, access from other workflows, continuity over time, and some benefit when making something later.
2. **A map is not necessarily a workspace.** Seeing many dots is not the same as interacting effectively with many notes. If a person needs to read eight note excerpts and combine them into an outline, readable cards plus a collection may provide more task-relevant information per action.
3. **Stable places and accurate updates are in tension.** Continuously recomputing the ideal semantic map can improve current layout while impairing learned geography. A good design might preserve stable regions, move only changed notes, show proposed regrouping, or let the user save a view.
4. **One semantic position cannot express all meanings.** A note about hiring an engineer may concern people, budget, management, legal considerations, and a project. A single location loses perspectives. Local maps, overlapping collections, tags/facets, and multiple lenses offer different tradeoffs.
5. **Similarity is not intellectual usefulness.** A critique, exception, analogy, contradictory result, or relevant prior decision may be more useful than a topically similar note. Explanations and user feedback can distinguish these. Avoid describing an embedding-distance relationship as causal, evidentiary, or intentionally authored.
6. **The real novelty test happens after week one.** Letting users explore a beautiful personal landscape creates emotional appeal. The question is whether it becomes a repeated entry point to useful work without prodding. Product judgment needs field use, abandoned sessions, and maintenance costs.
7. **Avoid an undemanding control.** The alternatives must get the same semantic retrieval, group labels, previews, and bulk actions where feasible. Otherwise a map can seem useful when the experiment really measures embeddings or better previews.

## Alternative designs worth testing

| Design | What it could preserve | What it could improve | Main risk |
| --- | --- | --- | --- |
| Topic shelves with readable cards | Automatic grouping; whole-vault overview | Scanning, previewing, bulk selection; less navigation | Less global spatial intuition; taxonomy still fallible |
| Local neighborhood around an active note/question | Connections; rediscovery | Concrete intent, fewer notes, comprehensible relation evidence | Tunnel vision; distant connections omitted |
| Stable user boards with suggested additions | Spatial memory; interaction with many notes | Ownership, continuity, synthesis workspace | Manual maintenance; board proliferation |
| Saved lenses over notes | Multiple perspectives | Project/person/time/topic intersections; repeatable scope | Requires clear filter language |
| Semantic search with grouped results | Organization by ideas | Known-item retrieval; ranked readable results | Requires formulating a query |
| Small rediscovery shelf | Remembering forgotten material | Low-effort periodic resurfacing alongside current work | Repetitive suggestions; interruption without value |
| Hybrid atlas overview leading into cards/collections | Emotional overview; exploratory entry point | Detailed work happens in legible scope with actionable selection | Maintaining two views; confusing conceptual model |
| Outline/synthesis collection | Bulk work; ideas become output | Arrange source excerpts into an argument or plan | Less open-ended vault exploration |

## Validation plan: practical and falsifiable

These are proposed exploratory studies, not powered sample-size calculations. A small initial study diagnoses usability and decides which variants deserve larger tests; it cannot establish market demand.

### A. Observe the current job before pitching a map

Recruit roughly 12–16 people across researchers/writers, project-heavy professionals, personal-journal users, and casual collectors. Include people who stopped using graph/map tools and people with low-link vaults. Request demonstrations of their own recent refinding, organization, and synthesis difficulties. Sample different corpus sizes, languages, note lengths, and capture habits. Record what failed, how frequently it happens, what they already pay for, and the last time it delayed real work.

Do not ask “Would you use a map?” Ask them to locate something, reconnect with a stalled project, and build a short artifact using their real notes. Their spontaneous strategies are more informative than feature enthusiasm.

### B. Compare representations while holding intelligence constant

Within-subject, counterbalanced trials: (1) current Atlas; (2) same topic grouping in readable card shelves; (3) search with grouped previews and facets; (4) active-note local neighborhood or a user board. Use matched but different tasks to reduce memorization. Provide equal access to preview and bulk actions. Separate maps from recommendation quality in the instrumentation.

Tasks and outcomes:

| Job | Task | Better evidence than clicks |
| --- | --- | --- |
| Refinding | Locate a known older note from partial remembered context | Success; time; failed openings; confidence calibration |
| Rediscovery | Recover an older note relevant to an active personal project | Participant-rated unexpectedness **and** usefulness; source relevance; reuse after 7–14 days |
| Bulk organization | Collect useful notes on an overlapping theme | Correct inclusion/exclusion; time; correction burden; ability to undo; later retrieval |
| Synthesis | Produce an outline/decision brief from several notes | Blind rubric for completeness, cited support, useful connections, unsupported leaps; completion time |
| Continuity | Repeat a task after adding/editing a subset of notes | Refinding degradation; location confusion; trust; unwanted regrouping |
| Large corpus | Repeat on a dense/noisy section of a real vault | Label legibility; navigation cost; relevant material exposed; crashes/latency |

### C. Four-to-six-week voluntary field trial

Offer variants to participants with real ongoing work and observe usage without required map sessions. Track successful work episodes, subsequent note reuse, voluntary return by week, and maintenance/correction time. Interview both returners and abandoners; ask what they did instead. Record local-only privacy expectations and willingness to wait for indexing as part of the workflow, not as abstract preferences.

Interpretation: a map that attracts long exploration but yields no subsequent reuse may be delightful decoration. A feature that users open less often but that reliably helps write something useful may be valuable. A shelf winning most tasks while users still prefer the overview might justify a hybrid, not abandoning every spatial element.

### D. Predeclare decision criteria

Choose thresholds before running comparative trials. Examples to refine: no loss of known-item retrieval success; meaningful improvement in useful rediscoveries per unit time over equally intelligent shelves; no unsupported relationship claims in synthesis; correction/maintenance time smaller than demonstrated downstream benefit; voluntary continued use after novelty declines. Report distributions and segments rather than averaging all users into one persona.

For geometry specifically, collect original-space neighbor fidelity and screen-position displacement after typical corpus changes. These diagnostic metrics do not replace user outcomes. A mathematically attractive projection can still be a bad interface; a somewhat distorted layout can still be useful when its visual meaning is limited and users can act reliably.
