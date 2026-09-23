# Deploying Morph

Morph deploys to Cloudflare Workers with Wrangler. The repository does not currently contain an active GitHub Actions deployment workflow, so deployment is a deliberate manual operation.

## Prerequisites

- Access to the Cloudflare account that owns the configured Worker resources
- Wrangler authentication through `pnpm wrangler login` or `CLOUDFLARE_API_TOKEN`
- Permission to edit Workers, D1, R2, Queues, Durable Objects, Containers, and secrets
- A running Docker daemon. `wrangler.jsonc` declares a container
  (`class_name: Sandbox`, `image: ./Dockerfile.sandbox`) and `wrangler deploy`
  builds and pushes that image as part of the deployment. Without Docker the
  deployment fails at the image build, not at the Worker.
- A reviewed database migration when one is pending

The existing `wrangler.jsonc` is environment-specific and already identifies the production D1, KV, and R2 resources. Do not replace those identifiers during a normal deployment.

## 1. Validate the application

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Resolve target-related failures before deploying. A successful build does not apply database migrations.

## 2. Configure production secrets

Store secrets through Wrangler rather than in `wrangler.jsonc`:

```bash
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put RESEND_API_KEY
```

`PUBLIC_URL` is a non-secret canonical CMS URL. For a split-domain deployment, set it to
the CMS hostname (for example `https://shop.example.com`), not the `workers.dev` fallback.
If more than one CMS/staging hostname must stay on the Morph router, set
`MORPH_PLATFORM_HOSTNAMES` to a comma-separated list. `MORPH_CMS_HOSTNAME` is a shortcut for
one CMS hostname and accepts either a hostname or a full origin.

Attach the CMS hostname to the Worker as a Cloudflare Custom Domain. In `wrangler.jsonc`, the
shape is:

```jsonc
"routes": [
  { "pattern": "shop.example.com", "custom_domain": true }
],
"vars": {
  "PUBLIC_URL": "https://shop.example.com",
  "MORPH_CMS_HOSTNAME": "shop.example.com"
}
```

Replace `shop.example.com` with the customer's real CMS hostname. The storefront hostname is
then connected from Dashboard → Settings → Domains; it is stored as an active storefront
domain and routed by the same Worker. Do not register the CMS hostname in that storefront
domain list.

## 3. Apply database migrations

The test is whether `drizzle/` has files this environment has not applied — not
whether the schema changed. Migrations here also carry data repairs, which touch
no schema at all: `0054_normalize_sales_channel_timestamps.sql` rewrites
`sales_channels` timestamps that an earlier migration wrote in SQLite's own
format, and reading "no schema change, skip it" would leave them wrong forever.
Review the pending SQL under `drizzle/`, then apply it:

```bash
pnpm db:migrate:prod
```

This command changes the remote D1 database. Skip it only when `drizzle/` holds
nothing the remote has not already applied; `wrangler d1 migrations list DATABASE --remote`
answers that.

## 4. Deploy

```bash
pnpm deploy
```

The command builds the application and runs `wrangler deploy`. That single step
does more than upload a Worker, and each part can fail on its own:

- **The container image.** `wrangler deploy` builds `Dockerfile.sandbox` and
  pushes it, because `containers` is configured. This needs Docker running
  locally and is usually the slowest part of a first deployment.
  `--containers-rollout none` deploys the Worker without touching Containers,
  which is the right flag only when the image is known to be unchanged.
- **The container rollout is gradual.** New instances replace old ones in steps,
  so immediately after a deploy some previews may still be served by the
  previous image. `wrangler containers instances <ID>` shows the state.
- **Durable Object migrations** in `wrangler.jsonc` under `migrations` run with
  the deployment. The `Sandbox` class is a Durable Object as well as a
  container; a rename or delete there is not reversible by redeploying.
- **The queue consumer** is bound in the same config as the producer
  (`morph-theme-builds`). A deployment that registers the producer but not the
  consumer accepts builds and never runs them, which looks like a hung build
  rather than a misconfiguration.

## 5. Verify

No test exercises the container path. The sandbox transport, the build runner
inside a container, the queue consumer and the container preview are covered by
types, unit tests and config parity, and none of that runs a container: the
end-to-end suite runs in an environment that omits `containers` on purpose and
asserts it got the sidecar instead. So this list is not a formality.

Some of it can be checked before deploying, and cheaply. `pnpm dev` uses the
default Wrangler environment, which declares `containers`, so a local dev server
runs the same `CloudflareSandboxVitePreviewServer` against a real Docker
container — reversible, and touching no remote resource. Doing that first turns
a deployment into a confirmation rather than a first attempt.

What only a deployment reaches: Cloudflare's own container runtime rather than
local Docker, the remote D1 and R2, the queue consumer, and the Worker as it is
actually served.

**The application**

- The public URL loads without a server error
- Sign-in and session restoration work
- An authorized user can open the dashboard
- Asset listing and asset delivery through `/assets/*` work
- Any feature changed by the release behaves correctly

**The container path.** Open the editor once and read the browser console. The
editor prints a line when a preview starts:

```
[preview-server] ready in 1393ms | transport=cloudflare-sandbox | stages: totalMs=… viteReadyMs=… | counts: …
```

- `transport=cloudflare-sandbox` is the check that matters. There is no sidecar
  in a deployment, so the container is the only thing that can have served it —
  but that is an argument from code, and an argument from code is what a bug
  breaks. Read the word.
- The stages say where the time went. `viteReadyMs` dominates locally; whether
  that holds in a container is the question this deployment answers.
- `reuse=reusedProcess` beside `readyMs=0` means no server was started, not that
  one started instantly. A first measurement should come from a cold start.
- `attempt=…` names the server-side record of the same start (below).

**When a preview is slow or reconnects.** Each start, incremental sync, renewal
and teardown writes one `[preview-observe]` line to the Worker log, tagged and
followed by a JSON object:

```
[preview-observe] start {"attemptId":"…","previewId":"…","concurrentAtEntry":0,"outcome":"ready","workspace":{"reused":false,"previous":"dirty","change":{…}},"vite":{"action":"restarted",…},"address":{"reused":true,"digest":"…"},"destroyed":null,…}
```

- One preview container is shared by every tab an author has open on a Theme,
  so a slow tab is usually explained by what another tab's `start` or `sync`
  did just before it: `vite.action` `restarted`, `address.reused` false (a new
  address; every frame on the old one goes stale), or a `destroy` line.
- `workspace.change` names the files that made a start rewrite the workspace,
  grouped as `preview-content`, `theme-source` and `platform`. `previous:
  "dirty"` means an incremental sync touched the workspace since the last full
  start.
- The Sandbox SDK's own `Stale preview URL blocked` warnings carry the same
  sandbox id as `previewId`; line the two up by time.
- The browser console adds `[preview-lifecycle]` lines for each Live Preview
  phase change, including automatic reconnects and why they happened.
- Preview addresses are credentials and are never logged; `address.digest`
  only tells two of them apart.

**A build.** Publish once, then read the structured line the service emits:

```json
{"scope":"storefront.theme.build.timings","runner":{"isolation":"sandbox-container","durationMs":…},"artifactMs":…,"totalMs":…}
```

- `runner.durationMs` is the build's own cost. The build row's
  `completed_at - started_at` is not: it contains the artifact upload as well.
  Measured in the local sandbox container, which is the same runner a deployment
  uses: 16.2-17.4s typical.
- `maxDurationMs` is 120s and is deliberately nowhere near that. It is the
  container command's kill threshold, so its job is to catch a build that has
  stopped progressing, not to decide how slow is too slow — a hung process never
  finishes, so any number far above the real distribution catches it, while a
  number close to it turns a loaded machine into a refused publish. It was 30s,
  set by nothing; two runs in ten crossed it while leaked containers competed for
  the machine. The default now carries its reasoning, and the runner's test pins
  it, so moving it is a deliberate edit rather than a drift.
- It governs the **code plane only** — it is the timeout for `vite build` inside
  the container. Publishing content is a D1 write with no container and no such
  threshold, and `artifactMs` is measured separately. A latency sample that mixes
  the two is describing neither.
- `isolation: "sandbox-container"` confirms the build ran in a container rather
  than in process.
- No line at all means the build was reused rather than run
  (`requestPreviewBuild` returns an existing success before orchestration), so a
  sample of these excludes the absence of a line, not a small value.
- Confirm the queue actually consumed the job rather than only accepting it, and
  that activating the release makes the storefront respond.

**The infrastructure**

- `wrangler containers instances <ID>` — the rollout is gradual, so check that
  instances are on the new image before trusting a timing
- If the release included a migration, verify the affected read and write paths
  against production D1

## Provisioning a separate environment

Provisioning is different from deploying the existing environment. For a new environment:

1. Create separate D1, R2, and KV resources.
2. Copy `wrangler.jsonc` into an environment-specific configuration.
3. Replace only the resource names and IDs for that environment.
4. Set independent Better Auth and email secrets.
5. Apply all migrations before serving real traffic.

The legacy `pnpm setup:cloudflare` script rewrites `wrangler.jsonc` and is not part of the normal Morph deployment flow. Review and update that script before using it to provision a new environment.

## CI status

`.github/workflows/ci.yml` is active on every push and pull request. It runs
typecheck, two static guards (`check:e2e-assertions`, `check:sql-timestamps`),
the unit suite, the production build with its three release guards, and an
editor end-to-end run against the loopback preview transport.

It does not deploy, and it does not exercise the container path: the end-to-end
job runs in the `local_preview_e2e` Wrangler environment, which omits
`containers` and `durable_objects` on purpose and asserts that the preview came
from the sidecar. A green CI therefore says nothing about the half of the system
this document covers.

If automated deployment is added later, it should perform the same sequence
documented here:

1. Install with the committed pnpm lockfile.
2. Run TypeScript, tests, and the production build.
3. Apply reviewed migrations only when intended.
4. Deploy with Wrangler.
5. Keep all credentials in GitHub Actions secrets.
