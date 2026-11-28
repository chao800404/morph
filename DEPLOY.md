# Deploying Morph

Morph deploys to Cloudflare Workers with Wrangler. The repository does not currently contain an active GitHub Actions deployment workflow, so deployment is a deliberate manual operation.

## Prerequisites

- Access to the Cloudflare account that owns the configured Worker resources
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the deploy, plus the separate
  inventory credential (`MORPH_INVENTORY_API_TOKEN`); see
  [Credentials, one per purpose](#credentials-one-per-purpose). A `wrangler login` session
  alone is refused: without `CLOUDFLARE_ACCOUNT_ID` Wrangler picks an account itself.
- A deploy target file (see [The deploy target](#the-deploy-target))
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
```

Configure the selected email provider separately; see
[Transactional email providers](#transactional-email-providers). The commands in
that section are operator instructions, not actions performed by the adapter.

`PUBLIC_URL` is a non-secret canonical CMS URL. Set it to the CMS hostname (for example
`https://shop.example.com`); the `workers.dev` value in the repository is a placeholder, and
the deploy refuses it because `workers_dev` is off. If more than one CMS/staging hostname must
stay on the Morph router, set `MORPH_PLATFORM_HOSTNAMES` to a comma-separated list.
`MORPH_CMS_HOSTNAME` is a shortcut for one CMS hostname and accepts either a hostname or a
full origin. `CLOUDFLARE_ZONE_ID` names the zone these hostnames are in:

```jsonc
"workers_dev": false,
"preview_urls": false,
// no "route" or "routes" key, not even []
"vars": {
  "PUBLIC_URL": "https://shop.example.com",
  "MORPH_CMS_HOSTNAME": "shop.example.com",
  "CLOUDFLARE_ZONE_ID": "<zone id>",
  "CLOUDFLARE_WORKER_SERVICE": "<the Worker name>"
}
```

**Do not put the CMS hostname in `routes`.** A `wrangler deploy` whose config lists Custom
Domains replaces the Worker's Custom Domains with that list, so every storefront domain
connected from Settings, and its DNS record, is removed by the next deploy. The CMS hostname
is bound once by `pnpm run platform:ensure`; storefront hostnames are connected from
Dashboard → Settings → Domains, stored as storefront domains and routed by the same Worker.
Do not register the CMS hostname in that storefront domain list (Settings refuses it). See
[Core deploy and hostname bindings](#core-deploy-and-hostname-bindings).

### Transactional email providers

The existing `cmsConfig.server: createServerOnlyFn(...)` callback returns
`{ database?, email?: EmailAdapter, ... }`. `CMSUserConfig` has no root email
setting. Construct the adapter in that callback with all sender identity, support
mailbox and credentials in its options. Core `getConfig.server` consumes that
instance directly and derives the internal support mailbox from its optional
`readonly supportAddress?: string` for existing templates; built-in helpers retain
this option as adapter metadata. There is no separate authored support setting.
The client view never invokes the server callback. Server environment overrides
in the repo default are `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` and
`EMAIL_SUPPORT_ADDRESS`. An explicitly
empty display name sends the mailbox without a name. Support configuration changes
the password-reset support link, not the message's Reply-To header; per-message
`from` and `replyTo` remain supported.

Import built-in `resendAdapter` / `cloudflareAdapter` helpers from
`@/lib/email/adapters` and email types from `@/lib/email/types`. Construct the
adapter and read credentials inside the existing
`server: createServerOnlyFn(...)` callback;
never instantiate a credential-bearing client/adapter or read secrets at module
scope or in client code. The [direct adapter example](README.md#transactional-email)
shows the server block containing both database and email settings.
Replace the adapter call and credentials inside that server callback to change
providers.

The old `EMAIL_PROVIDER` convenience option has been replaced by server adapter
configuration and is no longer used; setting it cannot switch providers. Set
`server().email` to a built-in helper result or any custom `EmailAdapter`.
Adding a provider requires no provider-name registration or change to `getConfig`.

**Owner action required before sending:** the existing defaults are preserved for
compatibility: `medusa@mail.cmsapp.org`, `medusa`, and `support@morph.com`. The
sender domain has expired and no replacement has been selected. Set owner-approved
addresses and verify the sending domain before enabling either provider. There is
an explicit `it.todo` for rejecting `cmsapp.org` and its subdomains as the configured
production sender; this is NOT a passing production-readiness check.

If `server().email` is omitted, mail remains unconfigured; core does not
invent a default provider. The repository's default server callback supplies Cloudflare Email Sending.

#### Cloudflare Email Sending (default)

The default server callback configures Cloudflare Email Sending alongside the
database. Environment variables:

- `CLOUDFLARE_EMAIL_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN`: the account and
  a dedicated token. The token needs the **Email Sending: Edit** permission.
- `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` and `EMAIL_SUPPORT_ADDRESS`: sender and
  support identity (see the owner action above).

Examples are in `.dev.vars.example` (local Worker) and `.env.example`. Leave the
credentials unset for local/E2E/CI runs: sends then fail visibly with a
"not configured" result and make no network call.

This adapter uses the [Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/),
not an Email Routing-only setup. It uses a dedicated account ID and token, so
email credentials are not coupled to the Theme deployment credentials. No Worker
binding, Wrangler configuration change, type regeneration or extra package is
required.

```ts
server: createServerOnlyFn(() => ({
  database: { connectionString: process.env.DATABASE_URL },
  email: cloudflareAdapter({
    defaultFromAddress:
      process.env.EMAIL_FROM_ADDRESS ?? "medusa@mail.cmsapp.org",
    defaultFromName: process.env.EMAIL_FROM_NAME ?? "medusa",
    supportAddress: process.env.EMAIL_SUPPORT_ADDRESS ?? "support@morph.com",
    accountId: process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
  }),
})),
```

#### Resend (alternative)

To use Resend, replace only the adapter call (and its import from
`@/lib/email/adapters`) in the same server callback:

```ts
server: createServerOnlyFn(() => ({
  database: { connectionString: process.env.DATABASE_URL },
  email: resendAdapter({
    defaultFromAddress:
      process.env.EMAIL_FROM_ADDRESS ?? "medusa@mail.cmsapp.org",
    defaultFromName: process.env.EMAIL_FROM_NAME ?? "medusa",
    supportAddress: process.env.EMAIL_SUPPORT_ADDRESS ?? "support@morph.com",
    apiKey: process.env.RESEND_API_KEY ?? "",
  }),
})),
```

Configure `RESEND_API_KEY`. In the Resend account, verify the owner-selected sending domain
and install the DNS records Resend supplies. Use a sending-only credential scoped
to the intended domain. Setting `RESEND_API_KEY` alone does not switch providers.

The following official-documentation review was recorded on 2026-10-18; this
documentation update does not revalidate the remote service:

- [Email Sending is beta](https://developers.cloudflare.com/email-service/).
  Sending to arbitrary customers requires Workers Paid and Email Sending access.
  Existing Email Routing access alone is not sufficient for that use case.
- [Onboard a sending domain](https://developers.cloudflare.com/email-service/get-started/send-emails/)
  using Cloudflare DNS. Without an onboarded sending domain, sends are restricted
  to verified destination addresses. After onboarding, arbitrary recipients are
  supported; account-specific quotas still apply.
- The [Workers binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
  also supports Email Sending now. It is not inherently a verified-recipient-only
  API, but binding restrictions and account/domain setup still matter. REST was
  chosen here to avoid an optional-binding compatibility path in local/E2E/CI.
- [Limits](https://developers.cloudflare.com/email-service/platform/limits/):
  at most 50 recipients per message (to, cc and bcc combined). Rechecked on
  2026-11-22: the documented total message size is now 25 MiB including
  attachments (it was 5 MiB in October). The adapter deliberately keeps a
  stricter 5 MiB cap on its JSON request, since transactional mail is small and
  base64 inflates attachments; this does not replace Cloudflare's own size
  check. Daily quotas are account-specific.
- [Suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/):
  with **Drop suppressed recipients** off (the default), the REST API rejects
  the request with 400; with it on, suppressed recipients are listed in
  `suppressed_recipients`. The adapter reports both cases as a failed send.

Operator steps, each requiring separate approval for remote changes:

1. Confirm the target account has Email Sending access and the required plan.
2. Choose the domain; in Compute → Email Service → Email Sending, onboard it.
   Review the actual generated [sending DNS records](https://developers.cloudflare.com/email-service/configuration/domains/):
   bounce MX/SPF on `cf-bounce`, sending DKIM and DMARC. Do not blindly replace
   existing SPF, MX or DMARC records or enable inbound Email Routing just to send.
3. Create an API token with **Email Sending: Edit** for the intended account.
   Supply `CLOUDFLARE_EMAIL_ACCOUNT_ID` and store
   `CLOUDFLARE_EMAIL_API_TOKEN` in the Worker's secret store. Do not reuse a broad
   deployment token, put secrets in `wrangler.jsonc`, or expose them as `VITE_*`.
4. Cloudflare is already the default adapter in the server callback. Configure
   the three sender/support settings above.
   A support mailbox also needs its own receiving-mail or forwarding setup;
   outbound domain verification does not create an inbox.
5. Only after authorization, validate one real delivery and sender authentication.
   This implementation has mock-only evidence: no DNS/account change, secret
   upload, deployment or real email has been performed.

#### Custom email adapters

Set `email` in the existing server callback to any object satisfying
`EmailAdapter`. Its required method is
`send(params: SendEmailParams): Promise<SendEmailResult>`; `readonly id?: string`,
`readonly supportAddress?: string` and
`sendBatch?(params: SendEmailParams[]): Promise<SendEmailResult[]>` are optional.
`getConfig.server` reads the support mailbox from this same adapter for existing
templates; it does not set a default Reply-To header.
Use a stable `id` to identify the adapter in commerce notification attempts. When
`sendBatch` is absent, the existing mail helper calls `send` for each message using
the same adapter; this is not a fallback to another provider.

For a concrete custom object, use this server block in the README example,
preserving any other server settings (import `cloudflareAdapter` from
`@/lib/email/adapters` and `EmailAdapter` from `@/lib/email/types`). The `email`
value is an ordinary `EmailAdapter` object; the transport here reuses the built-in
Cloudflare implementation:

```ts
server: createServerOnlyFn(() => {
  const transport = cloudflareAdapter({
    defaultFromAddress:
      process.env.EMAIL_FROM_ADDRESS ?? "medusa@mail.cmsapp.org",
    defaultFromName: process.env.EMAIL_FROM_NAME ?? "medusa",
    supportAddress: process.env.EMAIL_SUPPORT_ADDRESS ?? "support@morph.com",
    accountId: process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
  });
  const email: EmailAdapter = {
    id: "custom-cloudflare",
    supportAddress: transport.supportAddress,
    async send(params) {
      return transport.send(params);
    },
  };
  return {
    database: { connectionString: process.env.DATABASE_URL },
    email,
  };
}),
```

For another service, replace the transport with your own server-only integration
and map its response to `{ success: true, messageId? }` or
`{ success: false, error }`. Handle `to` as a mailbox or array, the default sender,
per-message `from` / `replyTo`, `subject`, `html`, optional `text` and attachments;
reject unsupported inputs explicitly. Keep credentials and provider clients inside
the server boundary and return safe errors without message bodies, OTPs, addresses
or tokens. Do not report success for an unconfigured transport or silently retry
an unknown delivery outcome. Return this object as `server().email` with
any support mailbox on the adapter itself.
No central provider union, registry or `getConfig` switch is needed.

#### Failure and delivery semantics

The server callback determines the adapter; available credentials do not select a
provider. Missing Cloudflare settings or provider rejection returns a visible
failed result; it never switches to Resend. With Resend chosen explicitly and
no key, the existing not-configured warning and `success:false`
behavior remain. Custom adapters must provide their own explicit failure handling.

The REST adapter treats HTTP errors, invalid responses, permanent bounces,
suppressed recipients and incomplete recipient acceptance as failures. Delivered
or queued recipients count as accepted, not proof of inbox delivery. An optional
`message_id` is retained when supplied; none is invented. Attachments use base64
content, and REST uses `address` / `reply_to`, distinct from the binding's field
names. A 15-second request deadline and refused redirects bound transport behavior.

New Cloudflare diagnostics contain fixed reason codes only, never arbitrary
provider error text, addresses, message bodies, OTPs or tokens. There is no
automatic retry or fallback: a timeout/transport error can have an unknown send
outcome, and a multi-recipient failure may already have delivered to some
recipients. Existing notification idempotency and caller failure handling are
unchanged. Resend's existing error handling is not redesigned by this change.

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
nothing the remote has not already applied. The deploy below checks exactly that
and stops if it is not so; to ask beforehand, run
`node scripts/check-pending-migrations.mjs --remote`, which only reads.

## 4. Deploy

```bash
pnpm run deploy
```

`pnpm run deploy`, not `pnpm deploy`: the latter is pnpm's own command for
copying a workspace package, and never runs this script. It takes no Wrangler
arguments: `--route`, `--domain`, `--config`, `--env` and every other argument
except `--target` are refused, never passed on. The guard, the inventory and
the credentials are described in
[Core deploy and hostname bindings](#core-deploy-and-hostname-bindings); in
order, the command:

1. checks the pinned tools, the environment, the deploy target and
   `wrangler.jsonc` (no route keys, both exposure flags `false`, exact
   identities);
2. removes `dist/` and `.wrangler/deploy/`, so nothing from an earlier build is
   checked or deployed;
3. runs the migration check below, against the target's database id;
4. reads the binding inventory and stops unless it is clean;
5. builds, then checks `.wrangler/deploy/config.json` and the artifact it
   points at (`dist/server/wrangler.json`);
6. runs the pinned Wrangler with a fixed argv;
7. reads the inventory again and compares it with step 4 — also when Wrangler
   failed, because an upload can commit before a later step fails.

The migration check reads the remote database against `drizzle/`, reading
`d1_migrations` and changing nothing, and stops when (the same rules as
`node scripts/check-pending-migrations.mjs --remote`, but read through the D1
API by the target's database id with the inventory credential, so no `.env`
or other Wrangler config can point it at another database):

- a migration file has not been applied — apply it (step 3), then deploy;
- the database has applied a migration this checkout does not have — the code
  is older than the schema, from a stale branch or someone else's deploy;
- two migration files share a number, so their order is an accident of their
  names.

It then builds the application and runs `wrangler deploy`. That single step
does more than upload a Worker, and each part can fail on its own:

- **The container image.** `wrangler deploy` builds `Dockerfile.sandbox` and
  pushes it, because `containers` is configured. This needs Docker running
  locally and is usually the slowest part of a first deployment.
  `pnpm run deploy` always builds it: Wrangler's `--containers-rollout none`
  is not offered, because the deploy argv is fixed.
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

## Core deploy and hostname bindings

A Core deploy binds no hostname. Hostnames reach the Worker two ways, each with
one owner, and `wrangler deploy` is neither:

| Hostnames | Bound by | Recorded in |
| --------- | -------- | ----------- |
| Storefront domains | Dashboard → Settings → Domains (the storefront domain provider) | D1 `storefront_domains` |
| CMS / platform hostnames (`PUBLIC_URL`, `MORPH_CMS_HOSTNAME`, `MORPH_PLATFORM_HOSTNAMES`) | `pnpm run platform:ensure` | the Worker vars |
| The preview namespace's wildcard Route (`*.<THEME_PREVIEW_HOSTNAME>/*`, when it is a public name) | `pnpm run platform:ensure` | the Worker vars |

The runtime reads the same vars to reserve those hostnames: Settings refuses a
platform hostname and any host in the preview namespace as a storefront domain.

### Why `routes` is refused

Wrangler 4.146.0 sends no request to the Custom Domain or Workers Route write
endpoints when the effective route list is empty. A non-empty Custom Domain
list is sent as a replace-state changeset, which removes every Custom Domain
the list does not name, and without a terminal it also forces the override of
an existing origin or DNS record. A wildcard-only list sends a script-level
`PUT /routes`, which deletes the Worker's other Routes. So `wrangler.jsonc` has
no `route` or `routes` key in any section, not even `[]` (an empty list is
harmless in this Wrangler, but it inherits nothing only by accident and is one
edit away from a list), and `workers_dev` and `preview_urls` are both `false`.
The guard checks `wrangler.jsonc`, every `env` section, the
`.wrangler/deploy/config.json` redirect and the built
`dist/server/wrangler.json`, and refuses `WRANGLER_CI_OVERRIDE_NAME`,
`CLOUDFLARE_ENV`, a global API key and any API address but the official one.

Wrangler is pinned to exactly 4.146.0 (and the Vite plugin, whose output the
guard reads, to 1.62.4). Upgrading either means re-reading the route handling
in its source and re-running `src/lib/core-deploy/wrangler-trigger-writes.test.ts`
first; the deploy refuses another installed version.

### The deploy target

The deploy refuses unless the account, Worker name and resource ids in
`wrangler.jsonc`, in the built artifact and in `CLOUDFLARE_ACCOUNT_ID` all equal
a target file kept outside `wrangler.jsonc`:

```json
{
  "accountId": "<32-character account id>",
  "workerName": "morph",
  "environment": "production",
  "d1Databases": { "DATABASE": "<database_id>" },
  "kvNamespaces": { "KV": "<namespace id>" },
  "r2Buckets": { "R2_BUCKET": "<bucket name>" }
}
```

Pass it as `--target <file>` or `MORPH_DEPLOY_TARGET=<file>`.

### Credentials, one per purpose

| Variable | Used by | Needs |
| -------- | ------- | ----- |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | the build and `wrangler deploy` | Workers Scripts edit, Containers edit, Queues edit, account read. **No** Workers Routes or DNS edit, and no zone access: an ordinary deploy never writes a binding. |
| `MORPH_INVENTORY_API_TOKEN` | the migration check, the inventory before and after a deploy, `deploy:verify` | Workers Scripts read (Custom Domains list), Zone read and Workers Routes read for the platform zone, D1 read (two `SELECT`s, sent as POSTs to the query endpoint; check the grant separately from the SQL). Never passed to Wrangler. |
| `MORPH_BOOTSTRAP_API_TOKEN` | `platform:ensure` writes | Workers Scripts edit (Custom Domain attach), Workers Routes edit and DNS edit for the platform zone. Used only for that command; never passed to Wrangler. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` **Worker secrets** | the runtime storefront domain provider (Settings) and the Theme Worker deployer | Workers Scripts edit, Workers Routes/DNS edit for the storefront zone. Set with `wrangler secret put`; not the deploy shell's token. |

### Commands

```bash
pnpm run deploy:verify           # read-only: the binding inventory, exact identities
pnpm run deploy                  # guarded deploy; every binding must already be present
pnpm run deploy:bootstrap        # first deploy: platform bindings may still be missing
pnpm run platform:ensure         # create-only bootstrap/repair of platform bindings
```

A first deployment is `deploy:bootstrap`, then `platform:ensure`, then
`deploy:verify`. `platform:ensure` is resumable: it reads the current state,
creates only what is missing, stops at the first failed write, and finishes on
the next run. It never deletes, never moves a binding and never adopts one: a
hostname bound to another Worker, or named by a storefront domain row (even on
this Worker), is refused and nothing is written in that run. The Custom Domain
attach is a PUT, so every attach is followed by a re-read that must show exactly
one binding for the hostname, on this Worker. It cannot fence a second writer
racing it; the assumption is that platform hostnames are bound by this command
only. A Route existing proves nothing about wildcard DNS, TLS or HTTP for the
preview namespace: check a preview host resolves, presents a valid certificate
and reaches the Worker, separately.

### The inventory

Before and after a deploy, the inventory reads, through the API:

- D1 `storefront_domains` for every undeleted storefront — active rows must be
  bound; pending and failed rows are reported, not compared;
- every Custom Domain in the account, unfiltered, compared by hostname, domain
  id, service, environment and zone;
- every Workers Route in the platform zone, unfiltered, compared by pattern, id
  and Worker.

There is no count rule. A finding on one read is re-read, and so is a read
with a pending row (a connect in progress); findings in both of the last two
paired reads are drift, findings that moved are a connect or disconnect in
progress and reported apart. A storefront domain inside the preview namespace
is drift (routing would serve it as a preview), and so is a platform hostname
inside it. After the deploy, a storefront row that stayed active must keep the
same Cloudflare id and binding it had before. Only one deploy runs per
checkout (`.wrangler/core-deploy.lock`), and the checked redirect, artifact and
source must be unchanged right before Wrangler starts and after it exits. An inventory that cannot be read
refuses the deploy before it starts. After the deploy the exit code says what
the post-check found, with the Wrangler result reported separately:

| Exit | Meaning |
| ---- | ------- |
| 0 | deployed, bindings unchanged |
| 1 | refused before deploying (guard, migration check, build, pre-check) |
| 2 | Wrangler failed; the post-check found bindings unchanged |
| 3 | post-check: drift |
| 4 | post-check: a transition still moving |
| 5 | post-check: verification unavailable |

Each run writes its reports, with the binding ids, under
`.wrangler/core-deploy/<time>/`. A drift involving a storefront domain — a
missing binding, or a binding whose id differs from its D1 row — is reconciled
through the storefront lifecycle (disconnect and reconnect it in Settings), not
by a direct API call, which would leave D1 holding an id that a later
disconnect deletes by.

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
- The Theme Worker has no address of its own. Morph Core reaches it through
  the service binding only; the deployer writes `workers_dev: false` and
  `preview_urls: false`. In the Cloudflare dashboard, the Theme Worker's
  _Domains & Routes_ shows no workers.dev route and no preview URLs, and
  `https://morph-theme-<storefront>.<subdomain>.workers.dev` does not answer
  with the storefront — while the storefront's own domain still does, which is
  the service binding working.
- An SVG the storefront serves carries the isolation headers on the
  storefront's own URL, in the response to a GET — not a HEAD, which a server
  may answer differently:
  `curl -s -D - -o /dev/null https://<storefront>/<some>.svg` shows
  `content-security-policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`
  and `x-content-type-options: nosniff`. `pnpm verify:svg-isolation`
  proves the same headers stop script in Chromium, Firefox and WebKit, but
  against local servers and `wrangler dev`, not a deployed Worker.
- **SVG in `public/` (the deploy gate).** The first deployment with the SVG
  gate open (`themePublicSvgGate()` returns `"open"`) is not done until:
  1. A benign SVG is uploaded to a Theme's `public/` through the editor or
     Site public/, referenced by a component with `<img src="/<path>.svg">`,
     and published.
  2. Run the gate, which only sends GET requests:

     ```bash
     pnpm verify:deployed-svg --svg https://<storefront>/<path>.svg --page https://<storefront>/<page-with-the-img>
     ```

     In Chromium, Firefox and WebKit it checks that:
     - the GET response is 200 `image/svg+xml` with `nosniff` and the sandbox
       CSP, as Node fetches it and as each browser receives it;
     - the page's `<img>` is drawn;
     - the SVG opened directly is sandboxed (opaque origin);
     - script cannot run under production's own headers: the browser is given
       production's GET response with its body replaced by a script-carrying
       SVG, and must run nothing, while the same body without those headers
       must run (the control).

     Nothing malicious is uploaded or published. The replacement happens in
     the browser only. `pnpm verify:deployed-svg --self-test` shows the gate
     fails on a missing CSP, a wrong type, headers sent on HEAD but not GET,
     and an `<img>` that is not drawn.

  Only admins can upload, and every upload is validated, but until step 2
  passes treat SVG as provisional. **If any check fails**, withdraw SVG:
  revert the commit that opened the gate (back to `"closed"`) and deploy
  it, **and** republish a release without the SVG or roll back to one — a
  deployed release keeps serving its files whatever the code says. With the
  gate closed, publish refuses any revision that still holds an SVG.

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
[preview-observe] start {"attemptId":"…","previewId":"…","concurrentAtEntry":0,"outcome":"ready","workspace":{"reused":false,"previous":"dirty","change":{…},"update":"full"},"vite":{"action":"restarted",…},"address":{"reused":true,"digest":"…"},"failedClosed":null,…}
```

- One preview container is shared by every tab an author has open on a Theme,
  so a slow tab is usually explained by what another tab's `start` or `sync`
  did just before it: `vite.action` `restarted`, `address.reused` false (a new
  address; every frame on the old one goes stale), or a `fail-closed` line.
- `workspace.change` names the files that made a start rewrite the workspace,
  grouped as `preview-content`, `theme-source` and `platform`. `previous:
"dirty"` means an incremental sync touched the workspace since the last full
  start.
- `workspace.update` is what the start wrote: `none`, `content-only` (only
  the draft content snapshot changed, so Vite and every page it serves were
  left running), or `full` (everything, then Vite restarted). A
  `content-only` update needs the manifest to name the same fingerprint as
  the marker.
- After a `dirty` marker (an incremental sync or a failed start wrote since
  the last complete write) the manifest is not trusted; the start reads every
  planned file back instead. `workspace.verification` says how many were
  read, or why the disk could not be checked (`unplanned-files`,
  `binary-file`, ...), in which case the update is `full`.
- `workspace.committed: false` means another writer marked the workspace
  `dirty` while this start ran, so it left the clean marker uncommitted and
  the next start reads the disk again.
- A start that cannot finish never destroys the shared sandbox: it stops only
  the Vite process it launched and marks the workspace `dirty`
  (`fail-closed`), so the next start rebuilds it.
- The Sandbox SDK's own `Stale preview URL blocked` warnings carry the same
  sandbox id as `previewId`; line the two up by time.
- The browser console adds `[preview-lifecycle]` lines for each Live Preview
  phase change, including automatic reconnects and why they happened.
- `[preview-observe] proxy` lines record every preview response with an error
  status (and any slower than five seconds) as it left the Worker, with the
  SDK's error code and, for a 410, the container's state at that moment.
- The browser console adds `[preview-frame]` lines from the preview page
  itself: which of its module scripts failed to load and which requests were
  refused. A refusal there with no matching `proxy` line never reached the
  Worker — the browser answered it from its cache.
- `410 STALE_PREVIEW_URL` is the SDK's answer while the runtime behind a still
  valid address has not exposed the port again, for example just after the
  container restarted. It is temporary, so the Worker marks every preview
  error response `Cache-Control: no-store`.
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
