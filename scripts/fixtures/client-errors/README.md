# Client error verification fixture

This separate SvelteKit application uses the production client hook and error
component. Its routes throw real initial and update child-render errors, and an
expected application 404. It has no native backend, workspace owners or Pi tasks;
it cannot establish draft durability or root-shell containment.

From the repository root, start the owned fixture:

```sh
pnpm exec vite --config scripts/fixtures/client-errors/vite.config.js
```

It refuses an occupied port and serves <http://127.0.0.1:1447>. Follow
`docs/agents/ui-verification.md` with a unique WDIO session, navigating to this
fixture URL rather than the ordinary agent server. The existing Chrome session
configuration can be used to open the browser; its server lifecycle hooks are
not invoked by session open. Visit `/initial`, `/update` (then trigger the child
failure), and `/expected`. Inspect narrow and wide views, Tab into the read-only
diagnostic summary, and verify the secret sentinels are absent. Repeated snapshots
must retain the same reference. The error view has no recovery/navigation buttons.

For deterministic fresh regression:

```sh
pnpm test:client-errors
```

That command owns and closes a headless browser and loopback fixture server.
Generated Kit/Vite output and selected screenshots stay under ignored
`.scratch/package-capabilities/evidence/client-errors/`. A production build and
preview can also use this config; it writes only inside that directory. Stop
the owned server before running the fresh regression. Do not run a second
server on the same port or terminate another chat's server.
