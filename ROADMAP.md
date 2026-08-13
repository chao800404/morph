# Morph Product Roadmap

This roadmap describes Morph's intended product evolution from a commerce CMS into an AI-native commerce application platform deployed on Cloudflare. It is directional rather than a promise of dates or release order within a phase.

Architecture and security invariants remain authoritative in [`.agent/rules.md`](./.agent/rules.md). A roadmap item does not permit bypassing those rules, production authorization, migrations, review, validation, or rollback requirements.

## Product direction

Morph is intended to combine:

- Medusa-style modular commerce administration and data ownership.
- Shopify-style storefront themes, pages, templates, navigation, preview, and publishing.
- Schema-constrained AI page authoring for normal merchant workflows.
- A controlled interactive-section library for Canvas, WebGL, 3D, maps, and scroll experiences.
- An isolated code-agent workflow for advanced storefront customization.
- Eventually, a commerce-focused application generator rather than an unrestricted general-purpose app generator.

The default product path remains data-driven:

```text
Human Visual Editor ─┐
                     ├─> Page Document / Section Schema
AI Schema Authoring ─┘                │
                                      ├─> Draft Preview
                                      └─> Authorized Publish
                                                │
                                      Published Storefront Renderer
```

Ordinary content publishing must not require rebuilding or redeploying the storefront. Code generation is a separate advanced workflow.

## Current foundation

The repository already provides important parts of the platform foundation:

- TanStack Start dashboard and server runtime deployable to Cloudflare Workers.
- D1-backed commerce and CMS data, R2 assets, KV binding, Better Auth, and role-aware server functions.
- Commerce catalogue, cart, checkout, pricing, inventory, promotion, tax, order, and storefront-context boundaries.
- Storefront, theme, template, domain, page, immutable page revision, draft/published pointer, metadata, and revision-restore data models.
- Config-driven Dashboard navigation and dynamic collection routes.
- `/dashboard/online-store` and `/dashboard/pages` management foundations.
- Headless Store API for a separately implemented storefront.

The current foundation does not yet include the public page renderer, section registry, visual editor, AI page generation, interactive presets, sandbox build plane, or dynamic application schema.

## Phase 1 — Storefront Foundation

### User value

Published pages and templates become real customer-facing storefront routes without requiring a rebuild for content changes.

### Deliverables

- A single versioned `StorefrontPageDocument` contract shared by authoring, preview, AI, and rendering.
- A section registry with stable identifiers, strict props schemas, supported variants, responsive contracts, renderer entries, and schema migrations.
- Published-only DAL and DTO boundaries for storefront rendering.
- Hostname and sales-channel-aware page resolution.
- Public routes for home, pages, products, and collections.
- Theme tokens for typography, color, spacing, radius, layout width, and motion.
- Safe rich-text, asset, link, and commerce-reference rendering.
- Cache invalidation tied to atomic publish operations.
- SEO metadata, canonical URLs, sitemap, robots, and not-found handling.

### Cloudflare shape

- Workers for SSR, routing, and Store API.
- D1 for published page/theme/template state and commerce data.
- R2 for images, videos, documents, and 3D assets.
- Workers Cache or KV for published snapshots where measurement supports it.

### Completion criteria

- A published page renders from its published revision on a storefront domain.
- Draft data cannot be retrieved through public storefront routes.
- Product templates read current commerce DTOs rather than copied product values.
- Publishing content does not invoke a build or deploy.
- Previous published content remains recoverable.

### Not included

- Arbitrary React/TSX generation.
- Canvas/WebGL authoring.
- Runtime creation of new database modules.

## Phase 2 — Visual Editor

### User value

Merchants can build and maintain responsive storefront pages with a Shopify-style editor without touching source code.

### Deliverables

- Section tree with add, remove, duplicate, hide, reorder, and variant controls.
- Fields-driven section settings generated from registry schemas.
- Desktop, tablet, and mobile preview modes.
- Preview isolation from the Dashboard shell.
- Draft autosave with explicit save state and conflict handling.
- Undo/redo based on document operations or revision checkpoints.
- Selection overlays that connect preview elements to their editor controls.
- Keyboard-accessible ordering and editing flows.
- Publish review showing meaningful changes from the active published revision.

### Cloudflare shape

- Worker server functions for draft/revision coordination.
- D1 for documents, revisions, and publish records.
- Durable Objects only if realtime collaboration, presence, or document locking is introduced.

### Completion criteria

- Loading, empty, error, responsive, keyboard, and reduced-motion paths are verified.
- Refreshing or sharing a preview retains the intended draft safely.
- Concurrent edits cannot silently overwrite one another.
- Every editor operation produces a schema-valid document.

## Phase 3 — AI Schema Authoring

### User value

Merchants can describe a page or select an existing section and ask AI to generate or revise it within Morph's design system.

### Deliverables

- AI generation jobs with actor, site/page, model, schema version, status, validation errors, timestamps, and result revision.
- Prompt context assembled from allowed sections, variants, theme tokens, brand settings, assets, and public commerce DTOs.
- Structured output constrained to the section registry.
- Validation and bounded repair loop before a result can become a draft revision.
- Whole-page generation and selection-scoped section editing.
- AI-assisted copy, SEO, localization, asset suggestions, and structured data binding.
- Rate limits, quotas, cancellation, retry, observability, and cost attribution.
- Clear disclosure of AI-generated changes before approval.

### Cloudflare shape

- Workers AI or an external model accessed through a server-only provider boundary.
- AI Gateway where model routing, analytics, caching, or provider fallback is needed.
- Workflows and Queues for durable, retryable generation jobs.
- R2 for generated media and job artifacts.
- Vectorize only when semantic retrieval across assets, content, or component documentation is justified.

### Completion criteria

- Invalid or executable output never reaches a page revision.
- AI can create drafts but cannot publish or deploy.
- Cancelling or failing a job leaves the active draft and published version consistent.
- Secrets, raw database access, sessions, and unnecessary personal data are excluded from model context.

## Phase 4 — Interactive Section Library

### User value

Merchants can produce high-end interactive pages such as scroll stories, Canvas scenes, maps, and 3D product presentations without generating code.

### Initial presets

- `ScrollCanvasStorySection`
- `IoTNetworkPreset`
- `DeviceDataFlowPreset`
- `SmartCityMapPreset`
- `ImageSequenceScrollSection`
- `Product3DViewerSection`
- `MapStorySection`

### Deliverables

- Strict schemas for steps, assets, cameras, timelines, presentation variants, and safe performance limits.
- Desktop and mobile presentation strategies.
- Static or reduced-motion fallbacks.
- Asset preload budgets and failure states.
- Lazy loading and visibility-based runtime activation.
- Editor controls that expose semantic presets rather than shader or callback code.
- Performance instrumentation for load, memory, frame time, and interaction responsiveness.

### Cloudflare shape

- Worker-rendered page shell and registry metadata.
- R2 for GLB, image sequences, textures, and fallback media.
- CDN/cache delivery for immutable versioned assets.
- Cloudflare Images or media transformations only when the customer environment is provisioned and the capability is centrally enabled.

### Completion criteria

- Interactive pages remain usable without WebGL and with reduced motion.
- Document props cannot create unbounded downloads, render loops, or arbitrary code execution.
- Publishing preset configuration remains data-only and does not trigger a build.

## Phase 5 — Advanced Code Mode

### User value

Approved advanced users can request genuinely new storefront components or workflows that exceed the section library, while production remains protected by an isolated engineering pipeline.

### Deliverables

- A source workspace per project/site or an explicit shared-source customization model.
- Isolated sandbox execution with bounded CPU, memory, time, storage, network, and dependency access.
- Agent tools for scoped file reads and edits.
- Component registry and repository instructions supplied to the agent.
- TypeScript, lint, tests, production build, dependency policy, and security scans.
- Automated build-error repair with bounded attempts.
- Preview deployment and immutable preview URL.
- Human approval before production deployment.
- Source revision, prompt/change record, build logs, artifacts, deployment version, and rollback target.
- Production remains on the last known-good artifact when generation or deployment fails.

### Cloudflare shape

```text
Morph Control Plane Worker
          │
          ├─> Workflow / Queue
          │         │
          │         └─> Sandbox / Container build job
          │                    │
          │                    ├─> R2 source and artifacts
          │                    └─> Preview deployment
          │
          └─> Human approval -> production deployment
```

Potential platform services include Cloudflare Workflows, Queues, Sandbox SDK/Containers, Workers Builds, Worker versions, preview URLs, and rollbacks. Availability, pricing, limits, and customer provisioning must be verified before committing to a production design.

### Completion criteria

- Build infrastructure has no direct production database or production secret access.
- Generated code cannot deploy without approval.
- Every production deployment has a tested rollback target.
- Code Mode failure cannot block normal schema-based authoring or publishing.

## Phase 6 — Commerce Application Generator

### User value

Morph can generate commerce-adjacent applications such as B2B quotation portals, dealer portals, marketplace operations, subscriptions, service bookings, or product configurators.

### Deliverables

- A versioned Application Meta Schema for entities, fields, relations, permissions, views, actions, workflows, and APIs.
- Dynamic form, table, detail, navigation, and dashboard rendering based on that schema.
- Tenant-aware permission policies enforced server-side.
- Workflow triggers, conditions, waits, retries, actions, and audit history.
- Safe schema evolution and migration planning.
- Generated or generic API contracts with validation and rate limiting.
- A clear boundary between commerce source-of-truth modules and application-owned extension data.

### Implementation paths

1. Prefer a controlled runtime schema for common entities, forms, views, and workflows.
2. Use Code Mode only when an application requirement exceeds the runtime schema.
3. Never let runtime metadata directly become unchecked SQL, migrations, server code, or authorization logic.

### Completion criteria

- Generated applications preserve tenant isolation and server-side authorization.
- Schema changes are previewed, validated, reversible, and explicitly approved.
- Commerce records remain authoritative and are referenced rather than duplicated.
- A failed migration cannot leave a partially upgraded application visible.

### Scope boundary

The target is a **commerce-focused application generator**, not an unrestricted generator for every software category.

## Phase 7 — Cloudflare Multi-tenant Platform

### User value

Morph operates as a scalable SaaS with shared and isolated deployment options for different customer tiers.

### Target topology

```text
Morph Control Plane
├─ Accounts, organizations, projects, billing, entitlements
├─ AI jobs, builds, deployments, domains, audit records
└─ Tenant/runtime provisioning
           │
           ├─ Shared Storefront Runtime
           ├─ Dedicated Enterprise Runtime
           └─ Generated Application Runtime

Morph Data Plane
├─ Commerce services
├─ Storefront renderer and Store API
├─ Published cache and asset delivery
└─ Tenant-aware observability

Morph Build Plane
├─ Workflows and queues
├─ Sandboxes/containers
├─ Preview deployments
└─ Artifacts and rollback
```

### Deliverables

- Explicit tenant identity propagated through request, auth, server function, DAL, cache, asset, and deployment boundaries.
- Shared versus dedicated database/runtime strategy based on customer tier and measured limits.
- Domain provisioning, certificate state, preview domains, and production routing.
- Tenant-aware quotas, metering, billing events, logs, traces, backups, retention, and incident tooling.
- Service bindings or Workers for Platforms only after concrete tenancy and isolation requirements are established.
- Regional/data-residency strategy where required.
- Disaster recovery and tested restore procedures for data and deployed artifacts.

### Completion criteria

- No request can resolve data, cache entries, assets, secrets, previews, or deployments belonging to another tenant.
- A tenant can be migrated between shared and dedicated infrastructure without changing authored page semantics.
- Control-plane failure does not take already published storefronts offline.
- Build-plane failure cannot affect existing production runtimes.

## Product ceiling

If all phases are completed, Morph can become:

> An AI-native commerce platform that combines modular commerce operations, a visual storefront CMS, schema-constrained AI generation, interactive experiences, isolated code agents, and commerce-focused application generation on Cloudflare.

This ceiling is intentionally narrower than a completely unrestricted Base44/Lovable-style generator. Morph should compete through deeper commerce correctness, safer publishing, reusable visual authoring, and controlled extensibility rather than by generating every category of software.

## Cross-phase requirements

Every phase must preserve the following:

- Commerce data remains the single source of truth for products, prices, inventory, options, media, customers, orders, promotions, tax, and sales channels.
- Draft, preview, published, deployment, and production states remain distinct.
- AI cannot publish, deploy, migrate production, or expand its own permissions.
- All external input is validated at the server boundary.
- Generated or authored documents contain data, not executable code.
- Normal content publishing remains independent from Code Mode and the build plane.
- Every mutation has authorization, auditability, bounded work, failure handling, and an appropriate negative test.
- Cloudflare feature availability and customer provisioning are verified before enabling optional capabilities.
- Existing dynamic Dashboard routes, shared UI primitives, query boundaries, DALs, DTOs, and schema conventions remain the extension points; phases must not create parallel frameworks.

## Roadmap governance

- Phases are dependency-ordered, but work inside a phase may be split into smaller milestones.
- A later-phase experiment must not weaken or bypass an earlier-phase production boundary.
- Before beginning a phase, write a scoped architecture decision describing tenancy, data ownership, threat model, failure recovery, Cloudflare limits/cost, and migration path.
- A capability is not complete until its loading, empty, error, responsive, keyboard, authorization, negative, migration, rollback, and production-observability paths are verified in proportion to risk.
- Update this roadmap when a product decision changes; update `.agent/rules.md` only when an invariant or mandatory implementation boundary changes.
