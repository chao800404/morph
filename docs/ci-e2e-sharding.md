# Editor E2E CI isolation and sharding

The editor suite runs on six independent GitHub runners (three until
2026-10-16; see "Six shards" below). Every shard keeps
`workers: 1`, `fullyParallel: false`, and `retries: 0`. Each invocation creates
and seeds its own disposable D1 state and authenticates against that database.
The setup and preview-transport projects are required on every shard.

The former `editor-writes-paused.spec.ts` is split into `editor-writes-auth`,
`lost-editor-writes`, `recovery-editor-writes`, `structure-editor-writes`, and
`session-editor-writes` spec files, with shared helpers under
`e2e/helpers/editor-writes-paused.ts`. Its original 16 test bodies are preserved;
no waits, assertions, timeout values, or retry behavior are weakened.

The runner expands `--shard=N/6` into exact whole-file filters from
`scripts/editor-e2e-shards.mjs`. It does not also forward Playwright's native
shard flag: doing so would divide that subset a second time and lose tests.
Full and focused invocations without a shard flag remain unchanged.

The first three-shard allocation used successful run 37217174717's per-file
durations. Its native
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
and places files longest-first onto the lightest shard. The three-shard plan
then came from that run and projected 439 / 443 / 441 s: a projection, not a
measured run. Per-file seconds and their source run are recorded in
`scripts/editor-e2e-durations.json`.

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

## Six shards (2026-10-16)

By 10-16 the three-shard plan had drifted to 451 / 786 / 631 s of test bodies
(CI run 38902225114, main 41ef184), and the slowest shard job took about 16
minutes. The total divided by three was over the 480 s budget, so shards were
added, as the budget rule below says.

Five shards were checked first and rejected. `--shards=5` from run
38902225114 projects at most 378 s, but the same plan sums to 482–521 s on
three of the four 10-15 report runs (38685792753, 38717690006, 38799638557):
that run was the fastest of the five measured. Run-to-run variance on the same
files is large (editor-writes-auth 157–243 s, session-editor-writes 94–157 s).

The current plan is `--shards=6` from run 38902225114's reports, which cover
every collected editor test (157, including the newest local-code-sync test).
It projects 311 / 308 / 317 / 314 / 308 / 310 s, and at most 446 s per shard
when applied to each of the four earlier runs. Those are recomputations from
earlier reports, not a measured six-shard run, and they do not guarantee that
every future run stays under budget. In run 38902225114 each shard's files
passed at least 11 tests, above the runner's per-shard minimum of 4.

Six jobs cost more runner time than five or three, and the whole-run span does
not shrink below the `Typecheck, test, build` job, which already finishes last
from five shards on. What the sixth shard buys is budget headroom, not a
shorter run.

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
than silently running fewer shards. The check also fails on a file planned on
two shards, an empty shard, a matrix listing a shard twice, any job name,
`--shard=` flag or `editor-e2e-results-` artifact name left at another count,
and an acceptance job that no longer waits for the whole matrix or reads every
shard's report.

The `Typecheck, test, build` job took 9m45s in the same run, as long as a
shard. Once shards are rebalanced below it, it is the next thing to split;
measure it first.

## Coverage check

`node scripts/check-e2e-shards.mjs` compares the full collected suite with all
shard plans. It rejects missing or duplicate editor test IDs and missing
preconditions. The CI acceptance job also verifies the saved execution reports:
every shard's report must exist, both preconditions must actually pass, each shard
must execute editor tests, and at least 20 editor tests must pass in total.
Intentional environment-gated skips remain visible in the reports.

The runner retains its JSON report when `MORPH_E2E_REPORT_PATH` is set, and a
plain `--shard=N/6` no longer bypasses its minimum-execution guard. Failure
traces and reports are uploaded under unique per-shard artifact names.

The aggregate keeps the original `Editor end-to-end (local preview transport)`
check name. It runs even after failures and refuses any failed, cancelled, or
skipped matrix. `pnpm ship` always requires every check listed in
`scripts/ci-required-checks.mjs`, including every shard and the aggregate, to
appear and report success. The aggregate is waited for while every shard is
green but it has not appeared in GitHub's rollup yet; any other missing check
refuses once everything present has finished, and ship's deadline fails with
the missing checks named. Skipped or neutral is not success. There is no
required-only shortcut: `MORPH_SHIP_REQUIRED_ONLY` was removed, and ship stops
before pushing if it is set. Branch protection is unchanged.

## Full Start preview whole-file shards (2026-10-23)

The full Start preview is separate from the six client-only shards. CI run
39934613168 reached the 30-minute job limit with this suite still running;
a local full Start run with B1's acceptance spec took 39.2 minutes, of which
the acceptance file took 21.8 minutes. These are observations, not a promise
of future duration.

`START_PREVIEW_SHARDS` in `scripts/editor-e2e-start.mjs` allocates complete
spec files to two independent jobs. Each still uses one Playwright worker,
zero retries, and its own disposable database and sidecar. The job timeout and
test assertions are unchanged. The B1 acceptance spec is not in this branch;
when B1 is integrated, add it to the lighter full Start shard and remeasure
both jobs. If that one file exceeds the budget by itself, split the spec into
multiple physical files, preserving all cases and assertions.

The original `Editor E2E full Start preview` check remains as an aggregate.
It requires both matrix jobs to succeed and rechecks their latest-attempt JSON
reports, including setup and preview transport, the complete file plan, and
the three documented design skips. `pnpm ship` waits for both shard checks and
the aggregate. A missing, failed, cancelled, or skipped shard cannot be
accepted as a passing full Start run.

Typecheck, Vitest, and Build are split into parallel validation jobs by #293.
Wall-clock savings and runner-minute costs must be measured on the new CI;
more runners are not a guarantee of a proportional speedup.

Reference: https://playwright.dev/docs/test-sharding
