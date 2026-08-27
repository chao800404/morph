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

These invariants apply to both the primary agent and every delegated subagent. Detailed domain-specific rules remain in `.agents/rules/` and must be loaded as applicable.

## Delegation

Delegate work such as:
- implementation with clear acceptance criteria
- CRUD
- UI components
- tests
- repetitive or mechanical refactors
- lint/typecheck fixes
- straightforward bug fixes

Do not spawn unnecessary agents.
Do not have multiple agents scan the entire repository unnecessarily.
Use one write-capable implementation agent at a time by default. Parallelize only genuinely independent work with non-overlapping files or read-only investigation.

When delegating, give the subagent:
- a bounded objective
- the relevant files or module scope when known
- acceptance criteria
- the relevant repository rule files
- the checks it should run

After a subagent completes implementation:
1. Review its diff and summary.
2. Review its test/typecheck results.
3. Inspect architecture, security, data-integrity, and regression risks yourself.
4. Fix directly or delegate a bounded correction if needed.
5. The primary agent performs final repository-wide validation.

## Repository rule loading

Detailed Morph engineering rules live under `.agents/rules/`. Read the rule files relevant to the current task; do not load all of them by default when the task only touches one domain.

- `.agents/rules/01-core-architecture.md`: product architecture, SSOT, core working principles, Theme source workspace and storage boundaries.
- `.agents/rules/02-authoring-build-runtime.md`: Visual Editor, Page/Template authoring, Theme build, preview, release/runtime, AI authoring, interactive experiences.
- `.agents/rules/03-backend-data.md`: routing, server functions, authorization, DAL/service/storage, Drizzle/D1, commerce modules, aggregate writes, pagination and URL state.
- `.agents/rules/04-ui-quality-security.md`: UI primitives, DataTable/forms, TypeScript quality, security, testing, CI completion criteria and migrations.

If a task spans multiple domains, read all applicable files. The primary agent is responsible for ensuring delegated workers receive or load the applicable rules.

## Validation policy

Subagents should run focused checks for their bounded task and report exactly what was run.

Before the primary agent declares a normal code change complete, follow the repository completion rules and run the required repository-wide validation, including `pnpm typecheck`, `pnpm test`, and `pnpm build` unless the applicable rule explicitly says otherwise or the environment prevents it. Never claim a check passed if it was not actually run.
