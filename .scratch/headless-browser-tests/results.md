# Browser tests without desktop focus stealing

Progress: Complete. Default headless browser execution validated.

## Findings and change

The browser WDIO config supplied no Chrome headless argument. The installed
@wdio/tauri-service 1.3.0 changes the requested browserName from tauri to chrome
but preserves goog:chromeOptions. Added --headless=new by default there and an explicit 1440×1000 initial window
size for both modes, with
GNEAUXGHTS_E2E_HEADED=1 as an explicit visible-browser debug override. No test
assertions, skips, timeouts, or production application behavior changed.

Chrome headless renders without displaying platform windows; see the
[official Chrome documentation](https://developer.chrome.com/docs/chromium/headless).
A running test-owned Chrome process was observed with --headless=new and its
own temporary user-data directory. No desktop activation or native test was
invoked to verify this change.

Native Tauri startup explicitly shows and focuses the main window, and several
native specs explicitly request OS focus and assert visible/focused paint.
Hiding those windows would change the contract being tested. These remain a
separate opt-in suite for an available desktop or isolated machine/VM session.
The ordinary unit/support/Rust/Python checks do not launch the desktop app.

## Validation

- pnpm check:e2e passed.
- Initial headless run: 24/26 files passed. At the implicit small viewport,
  due-date scroll restoration changed by 155 px after an intercepted click,
  and a note-tags control was not interactable. The failure screenshot was
  780×397 px; browser.log retains this first failed experiment.
- With only the initial window size changed to 1440×1000, both failing files
  passed unchanged (5 cases); viewport-focused.log preserves the control.
  This corrects the test environment; it does not establish a production fix
  for interactions at the previous small viewport. Narrow responsive cases
  still run their own explicit sizes, including the passing note-tags case.
- Final full browser suite with explicit dimensions: all 26 files and
  109 cases passed in 2m41s (browser-final.log), exit 0. The dates spec
  still logs a recovered intercepted click; this is not a warning-free log.
- E2E typechecking and changed-file whitespace checks passed.
- The visible debug override was inspected, not executed, to avoid taking focus.
- This follow-up changes e2e/wdio.browser.conf.ts and e2e/README.md after the
  earlier pre-merge source manifest; that manifest identifies the prior snapshot.
