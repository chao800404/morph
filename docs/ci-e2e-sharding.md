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
compare all three collected selections with the unfiltered suite; a missing
file's tests or duplicated test IDs fail. Do not drop environment-gated files
to make a shard appear faster. Rebalance from actual CI report durations when
necessary without changing test bodies, retries, workers or timeout ceilings.

`node scripts/check-e2e-shards.mjs` compares the full collected suite with all
three shard plans. It rejects missing or duplicate editor test IDs and missing
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
