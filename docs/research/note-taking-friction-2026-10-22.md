# Note-taking friction and proposed experiments, 2026-10-22

Decision proposal: prioritize dependable capture and finding a remembered passage before adding more organization controls. Keep organization optional. This ranking is a product inference from the evidence below and Gneauxghts' stated purpose, not a measured ranking of population needs.

## Scope and evidence quality

This bounded review uses ten primary sources: two original studies, three official product documents, and five first-person discussion threads. The studies describe personal notes rather than classroom transcription. The discussions supply concrete failure mechanisms and counterexamples; their authors are self-selected and do not represent all Obsidian, Apple Notes, or general-population users. Official documentation establishes supported behavior, not its discoverability, adoption, or effectiveness. No contemporary representative survey establishing the prevalence of these problems was identified in this review.

Evidence labels below distinguish **empirical observation**, **documented behavior**, and **anecdote**. Proposed changes are explicitly **inferences** or testable **hypotheses**. Historical reports establish a need that somebody experienced, not a defect still present in a current competitor release.

## Evidence

| ID / type | Source-owned finding | Limits and implication |
| --- | --- | --- |
| E1 — empirical observation | Van Kleek et al., [*Note to Self*, CHI 2009](https://people.csail.mit.edu/msbernst/papers/note1546-vankleek.pdf), observed 42 list.it users for ten days. Half of their unprompted notes took at most ten seconds to capture; the median note contained seven words. Notes could mix information types and abbreviate wording. | A short trial of a particular lightweight browser tool; median collection was only eleven unprompted notes per participant. Tool design and prompts could affect behavior. This supports testing low capture overhead, not a universal ten-second requirement or a claim about large-vault retrieval. |
| E2 — empirical observation | Bernstein et al., [*Information Scraps*, TOIS 2008](https://people.csail.mit.edu/msbernst/dev/TOIS-final-with-refs.pdf), interviewed 27 knowledge workers across five organizations and examined 533 scraps. Some participants described category assignment as excessive effort, especially for isolated information fitting multiple places (§§5.5.1–5.5.3). | Workplace sample, skewed toward IT, with participant-selected artifacts. Filing cost was reported, not experimentally timed. The researchers explicitly did not rigorously test refinding. Nearly all located scraps remained interpretable (§5.5.4), so the study does not establish that users forget their notes' meaning. |
| E3 — documented behavior | [Obsidian's iOS guide](https://obsidian.md/help/ios) describes Quick Capture from widgets or Shortcuts without waiting for the vault to load, creating a note or adding to an existing one. It specifies Obsidian 1.14+ and iOS/iPadOS 26+. | Version-scoped documentation; release-channel availability was not independently established. Low-overhead capture is already an explicit product capability, so an old capture complaint cannot be presented as a current missing feature. |
| E4 — documented behavior | [Obsidian Search](https://obsidian.md/help/plugins/search) distinguishes independent word matches from quoted phrases, offers scope operators, and documents filename A–Z as the default sort. Searching the active note is a separate command. | These are available controls, not proof users struggle with them. They expose distinct decisions about wording, scope, and ordering that an experiment can test. |
| E5 — documented behavior | [Apple's Notes search guide](https://support.apple.com/guide/notes/not18ab658ed/mac) documents body/attachment/image search, date-oriented natural-language queries, and Top Hits using factors including title match and recent edits. Find within one note is separate. | Current online Mac guide as served on the research date; account/provider capabilities vary. It establishes several supported retrieval cues, not evidence that any cue is best or routinely used. |
| E6 — anecdote, July 2021 | In [Quick Capture and Inbox Processing](https://forum.obsidian.md/t/quick-capture-mac-ios-and-inbox-processing/21808), maggiedelano described slower note creation, scripts to capture from elsewhere, work to process an inbox, and ideas entered into daily notes that did not resurface usefully. | A sophisticated individual's historical workflow. E3 documents subsequent native capture work. The durable question is whether capture and later use connect without requiring an inbox-processing habit. |
| E7 — anecdote with counterexamples, April 2025 | In [Is note organization killing productivity?](https://forum.obsidian.md/t/is-note-organization-tags-properties-folders-killing-productivity-thinking-of-using-only-titles-and-aliases/99972), grinty described choosing tags/properties/folders as a chore delaying writing. Other participants found properties natural or spent little time organizing while relying on folders and title keywords. | The disagreement matters: optional structure can help some users. The thread supports testing required decisions, not removing folders, titles, links, or tags universally. |
| E8 — anecdote with disagreement, 2020–2021 | In [Sort search results by relevance](https://forum.obsidian.md/t/global-search-sort-search-results-by-relevance-and-what-relevance-is/5933), users described excessive results, wanting title/phrase matches surfaced, and needing exact wording to narrow a remembered item. Another participant disputed any universal relevance metric. | Historical experiences were not reproduced against today's Obsidian. They motivate separate known-item and exploratory tasks, not an unqualified claim that semantic ranking solves search. |
| E9 — anecdote, April 2022 | An [Apple Community question](https://discussions.apple.com/thread/253848394) asks how to reach the next occurrence after searching Notes. A community reply explains Find in Note and occurrence navigation. | Evidence of one person's discoverability problem when moving from finding a note to finding text inside it; not an absent feature or an Apple engineering diagnosis. The indexed post text was inspected because direct fetch returned HTTP 429. |
| E10 — anecdote and maintainer response, 2023–2026 | An [Obsidian cursor-placement thread](https://forum.obsidian.md/t/incorrect-unexpected-cursor-placement-when-clicking-tapping-at-the-begin-or-end-of-lines-with-markdown-markers-bold-italics-etc/114024) reports clicks near formatted text placing the caret inside hidden markers, with unwanted formatting on Enter. WhiteNoise's September 3, 2026 reply says a fix will be in 1.14.0. | The thread is now in Bug graveyard; no claim of a remaining current defect. It identifies a useful editing test case: apparent visual position must agree with the next typing action. |

## Ranked experiments for Gneauxghts

These extend the app's existing capture, hybrid search, excerpts, Recent, and Related surfaces. They are not a competitor feature checklist. Rankings reflect alignment and evidence strength; each hypothesis can fail.

### 1. Capture immediately, resume the interrupted task

**Inference:** capture overhead can consume a meaningful part of a short thought-recording interaction (E1–E3, E6–E7).

**Hypothesis:** one action from elsewhere to a focused, recoverable body draft, with no required title/folder/type choice, reduces abandoned captures. Compare the existing new-note route with a small capture surface that returns users to their previous work after saving. An optional destination can remember the last explicit choice; classification must not gate typing.

Measure invocation-to-first-character, capture completion time, abandoned captures, and successful recovery after dismissal/backgrounding/restart. Verify save failures remain visible and retryable before judging speed. Do not count a fast animation or closed window as successful durable capture.

### 2. Find the passage, not merely the note

**Inference:** retrieving a known idea includes choosing the right note and reaching the relevant text; wording, ranking, and search scope can each introduce work (E4–E5, E8–E9).

**Hypothesis:** preserving strong title/phrase matches while offering broader matches, then opening at a highlighted passage with next/previous occurrences, reduces reformulation and wrong opens. Test exact-title recall, approximate subject recall, two words from separate passages, and a long note with several occurrences. Compare existing behavior before changing fusion weights or excerpt generation. The [existing excerpt experiment](search-excerpt-experiment-2026-10-21.md) already finds ordinary late literal matches visible; a wholesale snippet replacement needs new evidence.

Measure correct passage reached, elapsed time, query reformulations, wrong-note opens, and successful return to the prior editing position. A semantic result must not displace an obvious exact item without improving observed task success.

### 3. Offer cues at retrieval time; require no filing ceremony

**Inference:** the cost is often deciding where an idea belongs, while familiar voluntary structures can remain useful (E2, E7). Date and attachment cues are documented alternatives (E5); their effectiveness here is unproven.

**Hypothesis:** optional, reversible time/type filters and restrained Related suggestions help users retrieve uncategorized notes without creating tagging work. Compare current search/Recent with a small set of retrieval-time cues, including tasks where users remember when something happened but not its wording. Keep manual links and titles available. Do not automatically move, rewrite, or demand acceptance of classifications.

Measure refinding success after a delay, time spent organizing before capture, filter reversals, and unsuccessful cue combinations. Include users who already rely comfortably on folders; improvement for non-filers must not erase their route. Automatic organization and a resurfacing feed remain lower-confidence hypotheses, not justified defaults.

### 4. Make formatting mechanically predictable before adding motion

**Inference:** extra caret corrections can negate a visually pleasant editor (E10). The reviewed evidence does not show that decorative animation improves note capture or retrieval.

**Hypothesis:** consistent empty-selection bold/italic behavior, stable caret placement at formatting boundaries, predictable list exit, and reliable undo reduce corrections. Compare paired delimiters/current-word formatting in a small experiment rather than choosing from developer preference. Exercise keyboard and pointer input, nested formatting, block moves, menus near viewport edges, and reduced-motion mode. Motion should preserve selection and viewport position while making state changes understandable.

Measure corrective keystrokes, unexpected formatting continuation, selection/caret jumps, undo recovery, and task completion. Record visual polish separately from writing success.

## How to turn these into stronger decisions

Start with a formative sample of 8–12 people spanning ordinary Apple Notes use, newer and established Obsidian use, and informal notes without a formal organization system. This is a proposed research design, not enough to estimate population percentages. Avoid recruiting only plugin enthusiasts or people already committed to a knowledge-management method.

Use participants' own safely shareable older notes and real remembered needs, alongside controlled tasks that isolate behavior. Counterbalance baseline and experimental versions; use different equivalent targets to reduce practice effects. Add a delayed session so retrieval does not merely test memory of a note just created. Include larger collections and mixed short ideas/long notes, which E1 does not cover.

Choose adoption gates before testing: improve capture completion or correct-passage retrieval without lost drafts, exact-match regressions, or increased correction work. Report individual task outcomes and disagreements. Larger representative sampling would be needed to say what the general population struggles with most. No source here establishes that AI chat, automatic tags, a graph, or more animation is the next feature to build.
