# Deploying Morph

Morph deploys to Cloudflare Workers with Wrangler. The repository does not currently contain an active GitHub Actions deployment workflow, so deployment is a deliberate manual operation.

## Prerequisites

- Access to the Cloudflare account that owns the configured Worker resources
- Wrangler authentication through `pnpm wrangler login` or `CLOUDFLARE_API_TOKEN`
- Permission to edit Workers, D1, R2, and secrets
- A reviewed database migration when the schema has changed

The existing `wrangler.jsonc` is environment-specific and already identifies the production D1, KV, and R2 resources. Do not replace those identifiers during a normal deployment.

## 1. Validate the application

```powershell
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Resolve target-related failures before deploying. A successful build does not apply database migrations.

## 2. Configure production secrets

Store secrets through Wrangler rather than in `wrangler.jsonc`:

```powershell
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

When `src/db/*.schema.ts` changed, first review the generated SQL under `drizzle/`, then apply the committed migrations:

```powershell
pnpm db:migrate:prod
```

This command changes the remote D1 database. Do not run it for a deployment that contains no schema change.

## 4. Deploy

```powershell
pnpm deploy
```

The command builds the application and runs `wrangler deploy`.

## 5. Verify

After deployment, verify at minimum:

- The public URL loads without a server error
- Sign-in and session restoration work
- An authorized user can open the dashboard
- Asset listing and asset delivery through `/assets/*` work
- Any feature changed by the release behaves correctly

If the release included a schema change, also verify the affected read and write paths against production D1.

## Provisioning a separate environment

Provisioning is different from deploying the existing environment. For a new environment:

1. Create separate D1, R2, and KV resources.
2. Copy `wrangler.jsonc` into an environment-specific configuration.
3. Replace only the resource names and IDs for that environment.
4. Set independent Better Auth and email secrets.
5. Apply all migrations before serving real traffic.

The legacy `pnpm setup:cloudflare` script rewrites `wrangler.jsonc` and is not part of the normal Morph deployment flow. Review and update that script before using it to provision a new environment.

## CI status

No workflow is active under `.github/workflows/`. If automated deployment is added later, it should perform the same sequence documented here:

1. Install with the committed pnpm lockfile.
2. Run TypeScript, tests, and the production build.
3. Apply reviewed migrations only when intended.
4. Deploy with Wrangler.
5. Keep all credentials in GitHub Actions secrets.
