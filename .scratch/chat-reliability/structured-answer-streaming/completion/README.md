# Completed Rig 0.41 comparison

2026-10-11. Seven unfinished answers were completed before upgrading dependencies,
reusing the original completed verbose answer. The original Flex failure remains
in the parent directory; its unreported usage is excluded. Settings, prompts,
evidence, schemas and alternating arm order match the original pilot. No fallback
or additional failure occurred during the continuation.

| Measurement | Verbose | Compact |
| --- | ---: | ---: |
| Completed answers / model calls | 4 / 4 | 4 / 4 |
| Input tokens | 5,199 | 4,863 |
| Output tokens, including reasoning | 877 | 884 |
| Reasoning tokens, included above | 388 | 394 |
| Total reported tokens | 6,076 | 5,747 |
| Format valid | 4/4 | 2/4 |
| Manual facts and request scope pass | 3/4 | 3/4 |
| Manual citation coverage pass | 3/4 | 2/4 |
| Manual presentation pass | 2/4 | 2/4 |
| Median latency | 5,689.5 ms | 3,761 ms |

Compact saves 336 input tokens (6.46%) and 329 total tokens (5.41%). Across both
arms, completed answers report 11,823 tokens. There is one sample per arm/case;
latency differences do not establish a causal speed improvement or a reliability
rate. The fixed-evidence runner does not evaluate retrieval or the native UI.

**Do not promote compact formatting.** Two compact answers emit bracketed IDs
such as `[S1]` in source arrays instead of issued IDs; final validation rejects
both. Both formats wrongly attribute the approver from the full note to an excerpt
that only says approval was discussed. The verbose excerpt answer also leaks a raw
citation marker, and its historical-hold answer leaks formatting commentary.
Task facts and the latest hold versus planned completion distinction remain correct.
See [manual review](review.json) for exact output hashes and quoted evidence.

All eight answers emit real decoded provisional drafts with zero early source
links. Six valid results match final text. Two invalid final results clear draft
text and links. This supports the streaming seam, while native cancellation,
retry, stale-source handling and rendering remain unverified.

Reproduce analysis with `python3 completion/analyze.py` from the parent folder.
[summary.json](summary.json) is derived from raw results and manual review.
[run provenance](run-provenance.json) and [build provenance](build-provenance.json)
record the Rig 0.41 source and dependency hashes. Hosts were restored before the
subsequent production migration, verified in
[host-restoration-verification.json](host-restoration-verification.json).
The historical runner deliberately targets Rig 0.41; the current checkout's
upgraded runtime is not the executable source of these results.
