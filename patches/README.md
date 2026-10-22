# Dependency patches

## `@codemirror/view@6.43.15`

`enforceCursorAssoc()` corrects the native DOM selection at soft line wraps
from a deferred measurement. It must only write that selection while its editor
owns focus. In macOS WebKit, `Selection.collapse()` otherwise focuses the
contenteditable editor even after the user has focused another input. This made
search immediately close after clicking from a wrapped note at narrow widths.

The patch adds the focus guard at the selection writer in both distributed
module formats. Keep the version-pinned patch until an upstream release guards
this path; rerun `e2e/specs/native/search-focus.spec.ts` before removing it.
That native test uses the mounted editor's wrapping and deferred measurement,
checks repeated editor-to-search focus transfers, and checks focused typing at
the same wrap boundary.

## `@lezer/common@1.5.3`

`StructureCursor.hasNode()` checks whether a node can reuse an old mixed-parser
structure. Buffered nodes have no standalone tree identity, so seeking the old
structure before rejecting them repeats work that cannot succeed.

The patch returns before `moveTo()` when the queried cursor has no tree, in both
distributed module formats. Preserve 1.5.3's upstream `ExcludeBuffers` traversal
improvement alongside this guard. Keep the patch until upstream adds the early
rejection; rerun `e2e/support/mixedParserReuse.test.mjs` for syntax/mount parity,
partial parsing, incremental edits and deterministic traversal-work bounds.

## `@earendil-works/pi-ai@1.3.0`

Pi's ChatGPT OAuth login always uses `dynamic_agent_client`, creating a new app
registration even when reconnecting the same account on the same host. The
[OpenAI registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
requires returning sign-ins to reuse the issued client ID and omit
`agent_name_hint`. Native preferences retain that ID independently of tokens.

This patch adds an optional `LoginOptions.clientId`, reuses it for authorization
and code exchange, and accepts returning callbacks that omit `client_id` while
rejecting a different client ID. Pi retains PKCE, state checks, callback handling,
token exchange, cancellation and refresh. Keep the pinned patch until upstream
supports returning-client login; rerun `e2e/support/chatgptAuth.test.mjs` against
both the source and built helper before removing it. The tests control token
HTTP responses and use a real loopback callback without touching saved accounts.

Token request errors also retain the provider's structured OAuth error code as
`oauthError`. The native-only helper forwards a curated reauthorization code for
terminal refresh failures, allowing native credential retirement after confirmed
revocation without treating temporary failures as a request for another login.

## `@lezer/markdown@1.8.1`

`injectMarks()` merges blockquote/list markers into inline syntax. Repeated
insertion into a growing sibling array shifts the remaining elements for every
marker, making a long quoted paragraph with emphasis expensive to edit.

The patch appends merged siblings to an output array in both distributed module
formats. It preserves marker nesting, element order, ranges, opaque trees and
existing recursive behavior. It does not split paragraphs or change the dialect.
Large inline containers with many nested markers can still require repeated
recursive copying; this patch addresses the measured sibling insertion cost.

The same patch retains identity-based dispatch buckets for built-in inline
parsers and an equivalent ASCII previous-character check for GFM Autolink.
Custom/replaced parsers retain their configured order and non-ASCII behavior.
`e2e/support/markdownInlineDispatch.test.mjs` and
`e2e/support/markdownAutolink.test.mjs` protect those semantics in ESM and CommonJS.

`e2e/support/markdownParserPatch.test.mjs` checks frozen unmodified-parser trees,
opaque-tree properties, incremental edits and a deterministic array-work bound
through both ESM and CommonJS. Before removing or replacing the patch, run those
checks, `e2e/specs/native/markdown-marker-merge.spec.ts`, the visible-Markdown and
foreground cursor suites, and the full-app quote benchmark. Upstream 1.8.1 keeps
this insertion loop; its grouping-node reuse improvement addresses other shapes
of document. See [the investigation](../docs/research/markdown-giant-quote-parsing.md).

All three editor/parser patches were rebased together; exact overrides and patch
keys must match their versions. See the [upgrade and measured acceptance](../docs/research/codemirror-lezer-upgrade-2026-10-21.md).
