# Browser tests

These drive a real Chromium against a running dev server. They are not part of
`pnpm test`, which stays in jsdom and stays fast.

## Running them

```bash
E2E_EMAIL=you@example.com E2E_PASSWORD=... \
E2E_EDITOR_PATH='/store/<storefrontId>/themes/<themeId>/editor?template=index&viewport=desktop' \
pnpm test:e2e
```

Without those variables every test skips, so the command is safe to run
anywhere. Credentials are read from the environment and never committed; the
saved session lands in `e2e/.auth/`, which is ignored by git.

A dev server on port 3000 is reused if one is already running.

### One run per machine

`pnpm test:e2e:local-preview` (`scripts/run-editor-e2e.mjs`) takes a
machine-wide lock (`/tmp/morph-editor-e2e.lock`, shared within one WSL
distribution whatever TMPDIR or folder) before it starts anything shared, and
waits for it, so two runs never overlap. It is mutual exclusion, not a queue:
of several waiting runs, which goes next is not defined. While it waits it
prints who holds the slot (pid, folder, start time, arguments).

The runner itself holds the lock for its whole life (its open descriptor on
the lock file), together with a guardian process that shares it. The lock goes
only when both are gone:

- Killing the guardian, or anything else, while the run is going does not
  free the slot.
- A normal or interrupted run stops everything it started, then releases.
- A run killed outright leaves the guardian holding the slot. The guardian
  stops the process groups the run registered (TERM, then KILL after ten
  seconds), waits until they are gone, with no timeout, and only then lets
  the lock go.

**A container run's containers are its own by name.** With
`MORPH_E2E_TRANSPORT=cloudflare-sandbox` the runner gives the dev server a
worker name of its own (`morph-e2e-<id>`, via `MORPH_E2E_WORKER_NAME` and the
Cloudflare plugin's `config` in `vite.config.ts`). workerd names a container
after its Durable Object namespace, `<worker>-<class>`, so every container the
run starts is `workerd-morph-e2e-<id>-…`. Nothing else has that prefix — a
developer's own `pnpm dev` is `workerd-morph-…`, another run has its own id —
so the run can remove exactly its own:

- At teardown, after the dev server has stopped, the runner removes the
  containers with its prefix. If Docker cannot confirm they are gone, the run
  hands the slot to the guardian instead of releasing it.
- A run killed outright: after stopping its process groups the guardian
  removes the containers with its prefix and keeps the slot until Docker
  reports none, asking again while Docker cannot be reached.
- Nothing is removed by "it appeared during the run" any more; the old
  `MORPH_E2E_REAP_CONTAINERS` switch is gone.
- A waiting run shows what the slot is held for while a guardian cleans up:
  stopping processes, removing containers, or Docker not answering (and since
  when).

**Not isolated yet: the Cloudflare plugin's own teardown.** When any dev server
stops, `@cloudflare/vite-plugin` removes containers by
`docker ps --filter ancestor=<its image tag>`. Each session's tag is random,
but identical builds share one image id, and Docker resolves `ancestor` to that
id — so stopping one dev server or E2E run removes every session's Sandbox
containers built from the same image (checked on 2026-10-10 with a stopped
container of our own: `ancestor=` another session's tag matched it; an image
differing only by a `LABEL` did not). The runner's naming does not change
this. Until E2E runs build an image of their own, a container-transport run is
not safe beside another session's sandbox.

- `MORPH_E2E_LOCK=0` bypasses the protection entirely. Use it only for an
  isolated diagnosis with no other E2E run on the machine. It stops nothing.
- Without `flock` (macOS) the run goes ahead unlocked, and says so.
- Not covered: calling `playwright test` directly; a checkout from before the
  lock; the short synchronous steps (migrations, seed) of a run killed during
  them, which write only to that run's own state directory; load from unit
  tests or builds.

## Other browsers

Chromium always runs. Firefox and WebKit are opt-in, because each needs system
libraries this host may not have:

```bash
E2E_BROWSERS=firefox pnpm test:e2e
E2E_BROWSERS=firefox,webkit pnpm test:e2e
```

They are off by default so a missing browser never fails a suite that is
testing something else. Installing their libraries needs root:

```bash
sudo apt-get install -y libx11-xcb1          # Firefox
sudo npx playwright install-deps webkit      # WebKit: GTK + GStreamer, ~80 packages
```

## The publish loop

`e2e/publish.spec.ts` is skipped unless `E2E_ALLOW_PUBLISH=1`. It is not a read:
it builds the theme, creates a release and moves the storefront's production
pointer to it — and in any environment holding Cloudflare credentials it also
uploads and deploys that build. Run it only when you know what your environment
is wired to.

```bash
E2E_ALLOW_PUBLISH=1 pnpm test:e2e
```

Whether a publish reaches Cloudflare is decided by
`createServerThemeWorkerDeployer()`: with `MORPH_LOCAL_THEME_ORIGIN` set and no
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, it forwards to a locally
started Theme Worker and uploads nothing. Adding those credentials changes what
the same button does.

Publishing is also atomic, which is worth knowing before reaching for a smaller
version of it: `publishTemplate` writes D1 activation and moves
`active_release_id` before anything is sent to the Worker, and the deployment
lease is held around the whole sequence for that reason. There is no "publish
without activating".

`scripts/run-editor-e2e.mjs` therefore refuses to start when either Cloudflare
credential is in scope, naming the key and where it found it — the shell, or a
`.dev.vars` file it would load. Credentials are the real gate, because they are
what the factory reads; a flag could not do this job, since the flag is read in
the test process and the deployer is chosen in the Worker.

### What the slice establishes, and what it does not

| Claim | Established | How |
| --- | --- | --- |
| `active_release_id` moved to this release | yes | Read from D1 after the run, in one JOIN across `storefronts`, `storefront_releases` and `storefront_theme_builds`, so the pointer, the release and the build have to agree at one instant. Compared by the eight-character prefix the history panel renders, which is all the UI exposes. |
| The live release carries this run's edit | yes | The marker is written through the editor's own content field and lands in a theme template revision; the runner asserts the live release's content publication includes a revision containing it. Matched with `instr`, not `LIKE` — see the pattern cap below. |
| The release's artifact is whole, and runs | yes | Every file the build's own `manifest.json` declares is fetched from R2 and checked against the recorded `sizeBytes` and `sha256`. The runner then composes the wrangler config the way the deployer does — from `manifest.runtime.workerEntry` and `clientAssetsDirectory` — starts it, and asserts it answers. |
| Activation *caused* a Worker to serve it | **no** | Not locally possible. `OperatorManagedThemeWorkerDeployer` returns success without reading the request, because this is not a stubbed deployment — it is a topology where deployment is the operator's step, and here the harness performs that step. Only the credentialed deployer exercises the edge between activation and a running Worker. |
| The running artifact renders this run's edit | **no** | Morph publishes code and content separately: the artifact is the Theme Worker, and the content it renders is fetched at runtime as JSON from `StorefrontProductionService`, scoped to the release's `content_publication_id`. An artifact started on its own has no route to that endpoint, so it serves the theme shell. Reaching this would mean reproducing production host routing locally. |

The two `no` rows are why the others are worded as they are. A green run means the
pointer moved to a release cut from this run's edit, and that the bytes that
release points at are intact and execute. It does not mean Morph deployed
anything, and it does not mean a visitor would see the edit.

The compatibility date and flags in the config the runner generates are its own,
because the artifact does not carry the theme's wrangler config. A theme needing
some other flag could run here and still fail a real deploy.

## Things about this environment that cost time to find

Each of these was met while running the suite, and none of them announces itself.

**A named Wrangler environment replaces `.dev.vars`, it does not merge with it.**
Running with `CLOUDFLARE_ENV=local_preview_e2e` reads
`.dev.vars.local_preview_e2e` and nothing from `.dev.vars`, the same way `vars`
in `wrangler.jsonc` are not inherited by environments. A variable added for the
default environment is simply absent there.

**D1 refuses a LIKE pattern past some length it does not document.** A
`column LIKE '%<47 characters>%'` works; at 62 it fails with `D1_ERROR: LIKE or
GLOB pattern too complex: SQLITE_ERROR`. The message names the pattern, so it
reads as a broken query rather than a string that grew — sixteen characters is
the whole distance between working and that. Use `instr(column, ?) > 0`, which
takes a plain substring and has no pattern to be too complex. This is the second
time this limit has been hit; the first was a GLOB in
`0054_normalize_sales_channel_timestamps.sql`, which became length/instr
arithmetic for the same reason.

**Every run of the editor suite leaves a Docker container behind.** A
`workerd-morph-Sandbox-<hash>-proxy` survives the runner's cleanup, which stops
the dev server but does not reap containers workerd started through the Sandbox
binding. Ten accumulated in one session, after which the machine's load average
reached 57 and every run stalled in `openEditor` at "preview frame".

Never clear them by the shared name or image. A developer's own `pnpm dev`
starts a container with an identically shaped name, so
`docker rm $(docker ps --filter name=workerd-morph-Sandbox -q)` destroys their
session's sandbox along with the suite's leftovers — which is exactly what
happened here. The runner now names its own containers (`workerd-morph-e2e-<id>-…`,
see "One run per machine") and removes only those.

## What these tests change

They edit the theme they run against — a colour, a section order — and put it
back through the editor's own undo. A run that fails partway can leave an edit
behind; the last assertion in each test is the restoration, so a failure there
is telling you the workspace still needs a look.

## Custom component persistence

`authored-content.spec.ts` requires `E2E_SCRATCH_EDITOR_PATH` in addition to the
login configuration. Point it at a dedicated test theme using the `MyBanner`
source, route and infrastructure from
`src/lib/storefront/authored-from-scratch.test.tsx`, with a Document slot whose
id is `my-banner` and componentRef is `src/components/MyBanner.tsx`. Do not
register that component in the manifest. Use a short initial title so the heading
is visible in the canvas.

The test edits Title and text color through the Inspector, reloads the page to
check persistence, then restores the original visible values. It creates draft
revisions; use a disposable test theme. It does not delete existing components,
provision the fixture, or publish. Missing configuration skips the test and is
not evidence that the flow passed.
