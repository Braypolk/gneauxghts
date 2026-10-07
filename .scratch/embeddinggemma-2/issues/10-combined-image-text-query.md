# Refine an image search with text

Status: ready-for-human
Updated: 2026-10-06

## User requirement

Keep an attached image in the search bar while typing context to refine the
query. Search images and passages using both inputs together. This explicitly
supersedes the original deferral of combined queries; indexed representations
remain unchanged.

## Implementation

Gemma's existing native engine receives one input sequence containing the image
and plain refinement text, returning a single normalized 768-dimensional query.
The same image/text indexes and selected GPU/70 or optional 140 profile are used;
no new model or corpus rebuild is required. Refinement is bounded to 4 KiB UTF-8.
Unsupported providers report the capability rather than discarding the text.

The search store retains one temporary file/encoded-image source, debounces
text edits, serializes image inference and coalesces pending edits to the latest
query. Choosing an image preserves already-entered text; deleting text returns
to image-only search. Clear/Escape clear both inputs, results and preview. Mode
changes and disposal retire image resources and late responses. No query data
is written to history, imported as an asset or added to Markdown.

## Validation

New regression tests failed before implementation. Afterward, 35 focused
store/controller tests pass, including refinement retention, cached encoding,
coalescing during inference, clearing before late joint results/errors, and
option changes during the debounce after deleting refinement text.
Chrome verifies both command inputs, unchanged inline preview, Clear/Escape,
and subsequent keyboard image-result navigation. Type checking and cargo check
pass. Semantic tests: 134 passed, 8 ignored; native probes run separately.

The native GPU probe verifies finite/unit 768-dimensional joint vectors at 70
and 140 tokens, unchanged image-only output, a text-sensitive query, and bounds.
A Privacy screenshot plus Network Connection refinement ranks the Network
screenshot above Privacy at both budgets. Raw [combined-query results](../combined-query-results.json)
record this small constructed example; it is not broad quality evidence.
