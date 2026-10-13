# Touch editing actions

Implemented issue 04 from the iOS readiness plan for recent iPhones.

## Behavior

Tapping a rendered external Markdown link on a touch device offers Open link, Edit link and Close. Open uses the existing native opener and allowed URL normalization without changing note text. Edit reveals and selects the original Markdown and restores editor focus. Desktop plain-click editing and Cmd/Ctrl-click opening retain their existing behavior.

The action panel uses the shared floating-panel safe-area positioning, 44px button targets and a visible destination. Escape, outside pointer input, document/selection changes, backgrounding and editor destruction dismiss it. Actions require a completed click; cancelled touch does not activate them. Preventing the compatibility mousedown's default selection movement avoids a reproduced race where the link became raw Markdown and the panel closed immediately. Touch scrolling is not prevented.

On devices reporting a coarse pointer, chat Return inserts a newline, including hardware keyboard Return. Send explicitly submits the draft. Desktop Enter still submits and Shift+Enter inserts a newline. IME composition and the legacy 229 key code bypass submission, and the textarea requests a Return keyboard label.

## Validation

Seven mounted regressions in `e2e/specs/browser/touch-editing.spec.ts` cover actual Chrome touch start/end/cancel input, separate Open/Edit outcomes, exact opener URL and unmodified Markdown, panel dismissal, desktop link behavior, multiline mobile entry and one explicit Send, desktop keyboard submission, and both IME signals through the mounted composer on mobile and desktop. Eight existing link-shortcut/chat-control checks also pass (15 total). `pnpm check` passes with zero Svelte errors/warnings and clean E2E types; `git diff --check` passes.

The original test run reproduced plain link taps revealing source and mobile Return prematurely sending the first line. IME signals are synthetic, and browser keyboard input exercises the app policy without establishing physical iPhone keyboard or IME behavior. The native opener is a fixture boundary in browser tests. Repeat link opening/return, editing, scrolling, selection, IME and attached keyboard checks through normal packaging on a recent physical iPhone under issue 08.

The existing temporary iPhone 17 Pro / iOS 26.1 smoke package also loaded the current working-tree frontend after a clean relaunch. Software Return changed the restored `Test` draft to a second line; software keyboard taps produced `Test\nTest`, and keyboard dismissal retained both lines in New chat with no submitted message visible. No native Send was pressed and no provider call was attempted. This is a UI observation, not a new SQLite durability assertion. Native external-link opening, physical hardware keyboard and real IME coverage remain pending.
