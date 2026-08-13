# Morph

Morph is a configuration-driven CMS and administration dashboard built for Cloudflare. It combines TanStack Start, Better Auth, Drizzle ORM, D1, and R2 in one full-stack TypeScript application.

## Current capabilities

- Email/password authentication, password reset, session management, and role-based access with Better Auth
- Config-driven dashboard navigation, breadcrumbs, lazy-loaded views, and route data prefetching
- Asset and folder management backed by Cloudflare D1 and R2
- Asset upload validation, metadata editing, moving, soft deletion, and storage archival
- Account profile and active-session management
- Shared UI primitives based on Radix UI, Tailwind CSS, and shadcn conventions

Some product, marketing, and store views are registered as extension points and may still contain placeholder content.

### Optional features

Background removal depends on Cloudflare Image Resizing support and is disabled by default. Enable it for a customer only after their Cloudflare environment supports the transformation:

```ts
// src/cms.config.ts
features: {
  removeBackground: {
    enabled: true,
  },
},
```

When disabled or omitted, the AI Tools tab is hidden and the server function rejects direct requests.

## Technology

| Area                 | Technology                                |
| -------------------- | ----------------------------------------- |
| Application          | React 19, TanStack Start, TanStack Router |
| Server state         | TanStack Query                            |
| Forms and validation | TanStack Form, Zod                        |
| Authentication       | Better Auth                               |
| Database             | Cloudflare D1, Drizzle ORM                |
| Object storage       | Cloudflare R2                             |
| UI                   | Tailwind CSS v4, Radix UI, Motion         |
| Deployment           | Cloudflare Workers, Wrangler              |
| Test tooling         | Vitest, Testing Library                   |

## Local development

### Prerequisites

- Node.js 18 or newer
- pnpm 9 or newer

### Setup

```powershell
pnpm install
Copy-Item .env.example .env.development
pnpm db:migrate:dev
pnpm dev
```

The development server runs at `http://localhost:3000`. Wrangler stores the local D1 state under `.wrangler/`, which is ignored by Git.

On macOS or Linux, copy the environment file with:

```bash
cp .env.example .env.development
```

### Environment variables

| Variable                 | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | Signs Better Auth tokens and cookies; required                 |
| `PUBLIC_URL`             | Canonical application URL; use `http://localhost:3000` locally |
| `RESEND_API_KEY`         | Sends password-reset and verification email                    |
| `CLOUDFLARE_ACCOUNT_ID`  | Required by Drizzle Kit for remote D1 access                   |
| `CLOUDFLARE_DATABASE_ID` | Selects the remote D1 database                                 |
| `CLOUDFLARE_D1_TOKEN`    | Authorizes remote D1 migrations and Studio                     |

Do not commit real credentials. Production secrets must be stored with Wrangler or in the deployment platform's secret store.

## Architecture

```text
src/
├── auth/                  Better Auth configuration and permissions
├── components/            Shared UI and application components
├── db/                    Drizzle schemas and database access
├── lib/
│   ├── asset/             Asset DAL, DTOs, mappers, and utilities
│   ├── config/            CMS configuration types and navigation helpers
│   ├── email/             Email adapters and templates
│   └── validations/       Shared Zod schemas
├── routes/
│   ├── _backend/_auth/    Authentication pages
│   └── _backend/dashboard/
│       ├── -collections/  Dashboard module registry
│       ├── -components/   Dashboard-only shared components
│       ├── -queries/      TanStack Query keys and query options
│       └── -views/        Dashboard feature views
└── server/
    ├── asset/             Asset server functions and use-case coordination
    ├── auth/              Authentication server functions
    └── middleware/        Authentication and authorization boundaries
```

The dashboard is assembled through this path:

```text
src/cms.config.ts
  → dashboard/-collections/**
  → dynamic dashboard route
  → dashboard/-views/**
```

Collection configuration is the source of truth for dashboard navigation, breadcrumbs, lazy-loaded views, and optional route prefetching. Do not create a second page or navigation registry.

Server-side asset operations follow this boundary:

```text
route or component
  → TanStack Query
  → validated server function
  → authorization middleware
  → DAL
  → Drizzle / D1 and R2
```

## Adding a dashboard page

1. Add the feature under the matching `dashboard/-views/` domain.
2. Register its slug, label, icon, lazy component, and optional `loadData` in `dashboard/-collections/`.
3. Put reusable query keys and query options in `dashboard/-queries/`.
4. Validate shareable route state with the route search schema instead of duplicating it in component state.

## Database workflow

Application schemas live in `src/db/*.schema.ts` and must be re-exported by `src/db/schema.ts`.

```powershell
# Generate a migration after changing a schema
pnpm db:generate

# Apply committed migrations to the local D1 database
pnpm db:migrate:dev

# Inspect the local database
pnpm db:studio:dev
```

Better Auth owns `src/db/auth.schema.ts`. Prefer regenerating it through:

```powershell
pnpm auth:update
```

Remote migrations change production data and should only be run as an intentional deployment step:

```powershell
pnpm db:migrate:prod
```

## Commands

| Command                  | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `pnpm dev`               | Start the local development server on port 3000 |
| `pnpm build`             | Create a production build                       |
| `pnpm serve`             | Preview the production build                    |
| `pnpm test`              | Run the Vitest suite                            |
| `pnpm exec tsc --noEmit` | Run the strict TypeScript check                 |
| `pnpm db:generate`       | Generate a Drizzle migration                    |
| `pnpm db:migrate:dev`    | Apply migrations to local D1                    |
| `pnpm db:studio:dev`     | Open Drizzle Studio against local D1            |
| `pnpm cf-typegen`        | Refresh Cloudflare binding types                |
| `pnpm deploy`            | Build and deploy with Wrangler                  |

## Cloudflare resources

`wrangler.jsonc` defines these bindings:

- `DATABASE`: D1 database used by Drizzle and Better Auth
- `R2_BUCKET`: object storage for uploaded assets
- `KV`: reserved Cloudflare KV namespace

The current repository already contains environment-specific resource bindings. Do not run a setup script that rewrites `wrangler.jsonc` unless you are intentionally provisioning a separate Cloudflare environment.

See [DEPLOY.md](./DEPLOY.md) for the current manual deployment procedure.

## Development rules

Repository architecture, security, state-management, and validation rules are documented in [.agent/rules.md](./.agent/rules.md). The staged product and Cloudflare platform direction is documented in [ROADMAP.md](./ROADMAP.md).

## License

MIT
