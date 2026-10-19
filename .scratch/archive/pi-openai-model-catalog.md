# Pi OpenAI model suggestions

Completed 2026-10-18.

Settings and the composer now source OpenAI model IDs, names and ordering from
the installed Pi AI provider rather than the app-maintained six-model JSON file.
Pi 1.3.0 currently provides 44 entries, including GPT-6 Luna and GPT-6.1 Sol.
Updating the Pi dependency updates these suggestions without editing another list.

The existing positive reasoning controls derive supported levels from Pi's public
`getSupportedThinkingLevels` helper. Custom unknown model names no longer receive
guessed GPT-5 levels. Local model discovery and server-advertised reasoning remain
unchanged. Saved defaults, current/recent selections and custom model entry survive.

Native API-key discovery intersects account availability with catalog IDs supplied
by the frontend, retaining Pi's order and excluding unrelated API models. ChatGPT
discovery retains the account's visible models, including uncatalogued IDs. Known
subscription models display Pi's names in Settings.

Validation: 34 support tests, 1,312 frontend tests, two native discovery tests and
all 12 Settings browser journeys pass. Type checks and the production build pass.
The browser check compares the complete displayed list with the installed Pi
provider and verifies saved/custom model entry plus GPT-6 Luna Maximum reasoning.
This list change did not repeat live inference; the preceding subscription,
API-key and local note-flow acceptance is recorded separately in
[the subscription outcome](pi-chatgpt-subscription.md).
