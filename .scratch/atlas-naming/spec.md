# Atlas naming comparison

Benchmark the unchanged production KeyBERT-style labeler first, then an experimental embedding labeler on identical frozen cloud memberships, notes and indexed chunks. Use the real installed local Jina provider. Report model startup separately, three empty candidate-cache passes and five populated-cache passes. Labeling includes chunk loading, extraction, embedding, cache writes and assignment; excludes snapshot capture, compilation, map clustering, publication and rendering.

Improve representative coverage, candidate readability, topic-specific lexical evidence and map-wide name allocation. The experimental labeler scores 131 predefined one-word topics (with short definitions for ambiguous topics), extended by widely authored tags. Every member contributes titles, tags and up to two representative indexed chunks. Semantic similarity, note coverage, title/tag evidence and competing sibling clouds determine scores. A Hungarian assignment maximizes relevance across sibling clouds; parents and children use separate pools. The vocabulary is an explicit quality/coverage tradeoff, not unrestricted topic invention or part-of-speech tagging.

The user approved the improved names on 2026-10-04. Promote that policy as
`topic-atlas-v8` through the existing production label publisher. Retire the old
word-mining implementation, test-only comparison UI, benchmark harness and
launcher. Preserve useful naming/cache/publication regressions. Labels rebuild
on naming-version mismatch; structural geography remains compatible. Edits,
additions and removals follow the existing semantic indexing and generation
pipeline, with cached descriptor vectors reused for rescoring.

Benchmark methodology and measured results remain in the resolved comparison
issue as historical evidence. Private snapshot artifacts were disposable and
are not part of the production implementation.
