# Dependency patches

## `@codemirror/view@6.43.1`

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
