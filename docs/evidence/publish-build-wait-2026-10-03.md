# Publish build wait correction — local prototype evidence

## Scope

The editor previously abandoned its build wait after 30 one-second polls.
Both builds in the recorded failed acceptance succeeded after roughly 36–39
seconds, but neither was adopted by the UI; no publish call was made.
Historical failure: `/tmp/audit/start-final-published-20261003/`.

The existing waiter now follows the original immutable build until it settles
or its AbortSignal is cancelled. Explicit finite poll budgets remain available
for status-sampling callers. Poll results must match the original build ID,
store, Theme and source revision. Sleeping removes its abort listener after
each interval instead of accumulating listeners during longer waits.

The editor synchronously claims a single wait before its first write. Cancel
and unmount stop its continuation; a cancelled wait cannot adopt a later
preview-token result. Publishing retains its original template ID and draft /
release CAS preconditions. Before submitting it checks the current target,
workspace generation, conflicts, unsaved source, Monaco dirty files and a
successful fresh source-generation read. Server authorization and account
ownership checks still run through the existing write gate and middleware.

No deployment, remote migration or production mutation is involved. All
changes are local in the existing full-Start prototype; it is not merged.

## Evidence recorded so far

- Waiter focused tests: 12 passed, including success at poll 39, cancel at
  poll 40, wrong build/revision rejection, unreadable samples and existing
  abort/failure outcomes.
- First full suite after the initial fix: 4,263 passed, one skipped; build and
  typecheck passed. Subsequent conservative publish checks require final
  validation again; do not relabel this run as final-source acceptance.
- Sandbox published acceptance: 12 passed (1.8 minutes), including real UI
  build/publish and the published Theme through Core. Source fingerprints
  matched before and after:
  `5119eb7c4b46b1543712dfe7885bae9a816d1bc97bf8b095c25ec2cb645d598c`.
  Evidence: `/tmp/audit/publish-wait-fixed-20261003/published.json`.
  This precedes the final Monaco-dirty-file check and is not relabeled as
  acceptance of that later source. A fresh final run is required.

The controlled poll-39 unit test proves the old 30-poll behaviour fails the
new contract; the real published test alone is not proof that every run takes
more than 30 seconds. No E2E wait limit or existing assertion was weakened.

## Final fixed-source acceptance

After the last conservative Monaco check, source remained fixed throughout:

- `pnpm typecheck`: passed; `pnpm test`: 548 files / 4,263 tests passed, one
  file / test skipped; `pnpm build`: passed, including the client bundle,
  sidecar exclusion and deploy artifact secret guards.
- Final real Sandbox Start published acceptance: 12 passed (1.8 minutes).
  The UI created exactly one build, then issued exactly one publish request
  about 37 seconds later. All subsequent published-storefront cases ran.
- Fingerprint before and after the final E2E was identical:
  `34bd7a787fa06c80555308eed88d1290c254c88c1d51f27f01bace0292d67d89`.
- Full check logs: `/tmp/audit/publish-wait-frozen-{typecheck,test,build}.log`.
  Published traces and cleanup record:
  `/tmp/audit/publish-wait-frozen-e2e-20261003/`.
- The temporary Start environment flag was removed. The run wrapper removed
  only the new container whose exact identity matched this run; no unrelated
  worktree changes or existing developer container were removed.
- `git diff --check` passed. No commit, push, PR merge or CI run was performed.

## Still outside this fix

Cloudflare deployment/runtime binding and all other prototype opening gates
remain separate; a local published Worker is not a Cloudflare deployment.
