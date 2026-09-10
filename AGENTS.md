# Morph Codex agent policy

The primary agent is the technical lead.

## Primary agent responsibilities

The primary agent should handle:

- requirements analysis
- architecture
- task decomposition
- complex debugging
- security and data integrity decisions
- authorization, transaction, concurrency, OCC/CAS, revision/build/release, and production-safety decisions
- code review
- final validation

The primary agent may implement critical or tightly coupled code itself when delegation would increase risk or coordination cost.

## Critical invariants

Never:

- bypass authentication, authorization, ownership checks, OCC/CAS, or data-integrity guards
- create a parallel architecture, framework, storage contract, auth path, or publish path when an existing one should be extended
- manually modify generated files
- deploy production, run remote migrations, or mutate remote production resources unless explicitly requested
- claim tests, typecheck, build, or validation passed unless they were actually run

These invariants apply to the primary agent and to any delegated work. Detailed domain-specific rules remain in `.agents/rules/` and must be loaded as applicable.

## Repository rule loading

Detailed Morph engineering rules live under `.agents/rules/`. Read the rule files relevant to the current task; do not load all of them by default when the task only touches one domain.

- `.agents/rules/01-core-architecture.md`: product architecture, SSOT, core working principles, Theme source workspace and storage boundaries.
- `.agents/rules/02-authoring-build-runtime.md`: Visual Editor, Page/Template authoring, Theme build, preview, release/runtime, AI authoring, interactive experiences.
- `.agents/rules/03-backend-data.md`: routing, server functions, authorization, DAL/service/storage, Drizzle/D1, commerce modules, aggregate writes, pagination and URL state.
- `.agents/rules/04-ui-quality-security.md`: UI primitives, DataTable/forms, TypeScript quality, security, testing, CI completion criteria and migrations.

Each file opens with a `本檔鐵則` block: the handful of invariants whose violation has actually cost this project time. Read that block even when only skimming the file.

If a task spans multiple domains, read all applicable files. Anyone delegating work is responsible for passing on the applicable rules.

## Validation policy

Delegated work should run focused checks for its bounded task and report exactly what was run.

Before the primary agent declares a normal code change complete, follow the repository completion rules and run the required repository-wide validation, including `pnpm typecheck`, `pnpm test`, and `pnpm build` unless the applicable rule explicitly says otherwise or the environment prevents it. Never claim a check passed if it was not actually run.
