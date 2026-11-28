# 🚀 One-Click Deploy Guide

> **Not the Morph Core deploy procedure.** This guide is from the template Morph
> started from. Morph Core is deployed with `pnpm run deploy` as described in
> [DEPLOY.md](../DEPLOY.md) ("Core deploy and hostname bindings"): its Worker has
> `workers_dev` and `preview_urls` off and binds no hostname from its config,
> so a one-click deploy leaves it with no public address until
> `pnpm run platform:ensure` binds the CMS hostname. Never add `routes` to make
> it reachable: a deploy with a Custom Domain list removes every storefront
> domain connected from Settings.

Deploy this template to Cloudflare Workers in just a few clicks!

## Quick Start

1. **Click the deploy button** in the [README](../README.md)
2. **Authorize GitHub** - Allow Cloudflare to access your account
3. **Configure** - Select your Cloudflare account and name your Worker
4. **Deploy** - Wait 2-3 minutes for automatic setup

For the template, the app was live at `https://your-worker.workers.dev`; Morph Core turns workers.dev off (see the note above).

## ⚠️ Important: Initialize D1 Database

After deployment, your D1 database is created but **empty**. You need to apply migrations:

### Option 1: Using GitHub Actions (Recommended)

1. Go to your forked repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Add these secrets:
   - `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
   - `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
4. Go to **Actions** tab → Select "Deploy and Initialize D1"
5. Click "Run workflow" (If you changed the D1 database name during deployment, enter it in the input field)

This will automatically deploy and initialize your D1 database!

### Option 2: Manual Migration

```bash
# 1. Clone your repository
git clone https://github.com/YOUR_USERNAME/your-repo.git
cd your-repo

# 2. Install dependencies
pnpm install

# 3. Apply migrations to production D1
pnpm db:migrate:prod
```

## What Gets Created Automatically

- ✅ D1 Database (`better-auth-db`)
- ✅ KV Namespace (`better-auth-kv`)
- ✅ R2 Bucket (`better-auth-r2`)
- ✅ `BETTER_AUTH_SECRET` (default provided for testing)
- ✅ Automatic deployments on every push

## ⚠️ Important for Production

The deployment uses a default `BETTER_AUTH_SECRET` for testing. **Change it for production**:

```bash
# Generate a new secret
openssl rand -base64 32

# Set it in Cloudflare
pnpm wrangler secret put BETTER_AUTH_SECRET
# Paste the generated secret when prompted
```

## Troubleshooting

### Deployment Failed?

1. Check deployment logs in Cloudflare dashboard
2. Verify you have Cloudflare permissions
3. Try redeploying from the dashboard

### Need Manual Setup?

```bash
# Clone your repository
git clone https://github.com/YOUR_USERNAME/your-repo.git
cd your-repo

# Setup resources
export CLOUDFLARE_API_TOKEN="your_token"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
pnpm setup:cloudflare

# Deploy: the guarded Core deploy, never `wrangler deploy` with routes.
# It needs a deploy target and its own credentials; see DEPLOY.md,
# "Core deploy and hostname bindings".
pnpm run deploy:bootstrap
pnpm run platform:ensure
```

## Learn More

- [Main README](../README.md) - Full documentation
- [DEPLOY.md](../DEPLOY.md) - Detailed deployment guide
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
