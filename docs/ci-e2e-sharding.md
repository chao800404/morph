# Editor E2E CI isolation and sharding

The editor suite runs on three independent GitHub runners. Every shard keeps
`workers: 1`, `fullyParallel: false`, and `retries: 0`. Each invocation creates
and seeds its own disposable D1 state and authenticates against that database.
The setup and preview-transport projects are required on every shard.

The former `editor-writes-paused.spec.ts` is split into `editor-writes-auth`,
`lost-editor-writes`, `recovery-editor-writes`, `structure-editor-writes`, and
`session-editor-writes` spec files, with shared helpers under
`e2e/helpers/editor-writes-paused.ts`. Its original 16 test bodies are preserved;
no waits, assertions, timeout values, or retry behavior are weakened.

The runner expands `--shard=N/3` into exact whole-file filters from
`scripts/editor-e2e-shards.mjs`. It does not also forward Playwright's native
shard flag: doing so would divide that subset a second time and lose tests.
Full and focused invocations without a shard flag remain unchanged.

The allocation uses successful run 37217174717's per-file durations. Its native
file sharding took 11m45s / 3m23s / 9m54s including setup; test bodies alone
were about 569s / 67s / 493s. The reviewed new allocation projects about
374s / 380s / 376s of test bodies. These are estimates using old measurements,
not measured new CI results or a guaranteed runtime. Setup, teardown, machine
variation and intentional environment-gated skips are additional factors.

When adding or moving a spec, update the explicit plan. Architecture guards
compare all collected shard selections with the unfiltered suite; a missing
file's tests or duplicated test IDs fail. Do not drop environment-gated files
to make a shard appear faster. Rebalance from actual CI report durations when
necessary without changing test bodies, retries, workers or timeout ceilings.

## Rebalancing (2026-10-06)

The plan drifted as specs were added: CI run 37322994193 (main 2e03703)
measured 486 / 380 / 456 s of test bodies on it, and its shard jobs took
10m25s / 8m23s / 9m52s. Each job also spends about two minutes on install,
browser, dev server and preconditions, which moving files cannot change.

`scripts/rebalance-e2e-shards.mjs` reads a run's `shard-N.json` reports, sums
each file's editor test bodies (setup and transport preconditions excluded)
and places files longest-first onto the lightest shard. The current plan came
from that run and projects 439 / 443 / 441 s: a projection, not a measured
run. Per-file seconds and their source run are recorded in
`scripts/editor-e2e-durations.json`. With that run's results, each shard still
executes 27 / 15 / 19 tests, above the runner's per-shard minimum of 7.

To rebalance:

1. Download every `editor-e2e-results-N-attempt-M` artifact of one successful
   run into one directory (each shard's latest attempt is the one read).
2. `node scripts/rebalance-e2e-shards.mjs <dir> --write --source="CI run <id> (main <sha>)"`
3. Paste the printed plan into `EDITOR_SHARDS`, update its comment with the
   run and the measured/projected numbers, and check that each shard still
   executes at least the runner's per-shard minimum (`MORPH_E2E_MIN_TESTS`
   divided by the shard count, rounded up).
4. `node --test scripts/check-e2e-shards.test.mjs && node scripts/check-e2e-shards.mjs`

Moving files changes which specs share a shard's database. A test that starts
failing after a rebalance has an ordering dependency to fix, not a plan to
revert.

## Budget and adding a shard

`EDITOR_SHARD_BUDGET_SECONDS` (480 s of test bodies, about a ten-minute job)
is advisory: `check-e2e-shards` prints a GitHub warning when a shard projects
over it, when the total cannot fit the current count, or when a file has no
measurement yet. Warnings never fail the build; durations come from one run on
a shared runner. Act on them by rebalancing; add a shard only when the total
divided by the count is over budget.

The shard count is `EDITOR_SHARDS.length`. Adding one changes, in one pull
request: a new array in `EDITOR_SHARDS`, the workflow matrix, the job name's
`/N` and the runner's `--shard=${{ matrix.shard }}/N`. `check-e2e-shards`
compares the workflow with the plan, and `pnpm ship` waits for the same count
and refuses shard checks named for another, so a partial change fails rather
than silently running fewer shards.

The `Typecheck, test, build` job took 9m45s in the same run, as long as a
shard. Once shards are rebalanced below it, it is the next thing to split;
measure it first.

## Coverage check

`node scripts/check-e2e-shards.mjs` compares the full collected suite with all
shard plans. It rejects missing or duplicate editor test IDs and missing
preconditions. The CI acceptance job also verifies the saved execution reports:
all three reports must exist, both preconditions must actually pass, each shard
must execute editor tests, and at least 20 editor tests must pass in total.
Intentional environment-gated skips remain visible in the reports.

The runner retains its JSON report when `MORPH_E2E_REPORT_PATH` is set, and a
plain `--shard=N/3` no longer bypasses its minimum-execution guard. Failure
traces and reports are uploaded under unique per-shard artifact names.

The aggregate keeps the original `Editor end-to-end (local preview transport)`
check name. It runs even after failures and refuses any failed, cancelled, or
skipped matrix. When shard checks appear, `pnpm ship` requires all three shard
checks and the aggregate to report success, including when the aggregate has
not appeared in GitHub's rollup yet. Missing checks keep it waiting; skipped or
neutral shard acceptance is not success. This also prevents a required-only
shortcut from bypassing sharded acceptance. Branch protection is unchanged.

Typecheck, Vitest and Build remain in their existing job for this first stage.
Wall-clock savings and runner-minute costs must be measured on the new CI;
three runners are not a guarantee of a threefold speedup.

Reference: https://playwright.dev/docs/test-sharding
