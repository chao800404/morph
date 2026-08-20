# Agent delegation

The primary agent is the technical lead.

The primary agent should handle:
- requirements analysis
- architecture
- task decomposition
- complex debugging
- security and data integrity decisions
- code review
- final validation

Delegate clear and bounded implementation work to subagents.

Subagents should handle:
- implementation
- CRUD
- UI components
- tests
- repetitive refactors
- lint/typecheck fixes
- straightforward bug fixes

Prefer delegation when Luna can perform the task reliably.

Do not spawn unnecessary agents.
Do not have multiple agents scan the entire repository unnecessarily.

After a subagent completes implementation:
1. Review its changes.
2. Review test/typecheck results.
3. Fix or delegate corrections if needed.
4. The primary agent performs final validation.

## Repository rules

Before modifying Morph, read and follow all Markdown rule files under `.agents/rules/`. Together they are the authoritative engineering and architecture rule set for this repository.
