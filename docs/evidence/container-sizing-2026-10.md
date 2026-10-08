# Sandbox container sizing — local measurement, 2026-10-08

Evidence for choosing an `instance_type` and sleep timeouts for Morph's three
Sandbox containers (`Sandbox`, `PreviewSandbox`, `BuildPreviewSandbox`, all
from `Dockerfile.sandbox`). Measured locally in Docker only: nothing was
deployed, no Cloudflare resource was created or changed, and `wrangler.jsonc`
and product code are unchanged. The choice of instance type and timeouts is
left to the reader; this document gives the numbers and what fails where.

## Summary

`wrangler.jsonc` sets no `instance_type`, so all three containers currently
get Cloudflare's default, **lite** (1/16 vCPU, 256 MiB, 2 GB disk). Locally,
under lite's memory limit, **every one of the three workloads is killed by the
OOM killer**: both build kinds, the Live Preview and the Build Preview.

| Container             | Workload                                                                            | Measured, unconstrained (anon / `memory.peak`) | CPU                                                                                        | Smallest size that passed locally                                                                                     | Fails at the next smaller size because                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Sandbox`             | platform build of the starter Theme                                                 | 1,230–1,683 MiB / 1,316–1,759 MiB              | 62–87 CPU-s per build in the real containers (119 at host load 18); two `vite build` steps | standard-1 (½ vCPU) passed 2 of 3 replays (first step 83–88 s of the 120 s budget); standard-2 (1 vCPU) passed 3 of 3 | basic: the first `vite build` step hits the runner's 120 s per-command timeout, 2 of 2 (memory fits: 597–603 MiB peak under 1 GiB) |
| `Sandbox`             | native Start build (content-reading fixture of `native-publish-acceptance.spec.ts`) | 1,490–1,784 MiB / 1,636–1,914 MiB              | 85–104 CPU-s per build in the real containers; two prerender passes                        | standard-1 passed 1 of 2 valid replays (92 s and 99 s of 120 s); standard-2 passed 3 of 3                             | basic: both passes time out at 120 s, 2 of 2 (memory fits: 630–711 MiB peak)                                                       |
| `PreviewSandbox`      | Live Preview: start, idle, edit loop                                                | 446–475 MiB / 487–513 MiB                      | start 12–21 CPU-s; idle 0.044–0.055 vCPU; editing 0.07–0.10 vCPU average                   | basic (ready in 22 s at ¼ vCPU)                                                                                       | lite: OOM-killed before the dev server answers                                                                                     |
| `BuildPreviewSandbox` | Build Preview: start, then requests                                                 | 394–437 MiB / 432–459 MiB                      | start 4–6 CPU-s; a 45-request burst 1.4–2.8 CPU-s; idle 0.03–0.10 vCPU                     | basic (ready in 18 s at ¼ vCPU)                                                                                       | lite: OOM-killed before `wrangler dev` answers                                                                                     |

Three findings matter more than the peaks themselves:

1. **Build memory is elastic; build CPU is not.** Node sizes its heap from the
   cgroup limit. Unconstrained, a build grows to ~1.5–1.8 GiB, but under a
   1 GiB limit the same build completes at 690–841 MiB and under 768 MiB at
   586–703 MiB. The extra garbage collection costs CPU: against the
   unconstrained replay closest in host load, 1 GiB used 0.9–1.3× and
   768 MiB 1.4–1.6× the CPU-seconds (up to 2.6× against the quietest
   unconstrained replay). At 512 MiB both builds abort with
   `JavaScript heap out of memory`; at 256 MiB they are OOM-killed within
   seconds. What actually decides the build's size is the **vCPU quota
   against the runner's fixed 120 s per-command timeout** (`maxDurationMs`,
   `cloudflare-sandbox-vite-theme-build-runner.ts`).
2. **The previews idle at about 0.05 vCPU of active CPU**, which Cloudflare
   bills. In the Live Preview roughly half of it is Vite's watcher
   (`watch: { usePolling: true, interval: 100 }` in the generated preview
   config) and half the Sandbox control server.
3. **Host load moves the CPU numbers by about 2×.** The same captured native
   build used 82.6 CPU-s at 1 vCPU with host load 3.4 and 177.6 CPU-s with
   host load 9.2. Every row below carries the host's load average; read
   CPU-seconds and wall times as a range, and the low-load end as the closer
   estimate of an uncontended machine.

### What each container would need, with headroom

These are inputs for the decision, not the decision.

- **`Sandbox` (builds).** Sized by CPU. At 1 vCPU the longest step used
  33–35 % of the 120 s budget at host load 3–5 and 53–83 % at host load
  8–15; at ½ vCPU, 69–83 % at host load 3–6 and over 100 % at 6–8. For
  memory, 768 MiB was the lowest limit that passed (512 MiB failed), and
  unconstrained a build reached 1.8 GiB anon (1.9 GiB `memory.peak`).
  With headroom: **1 vCPU and at least 2 GiB** — standard-2
  (1 vCPU, 6 GiB), or a custom type of 1 vCPU / 3 GiB, the smallest custom
  shape Cloudflare allows (at least 3 GiB per vCPU), which keeps 1.6× over
  the largest unconstrained peak seen. standard-1 is the smallest that
  passed, without margin. A Theme larger than the starter, or a third build
  step, would need more CPU before it needs more memory; raising
  `maxDurationMs` would also change this answer.
- **`PreviewSandbox` (Live Preview).** Peaks during start-up at 446–475 MiB
  anon (≤ 513 MiB `memory.peak`) and settles near 380 MiB. **basic**
  (1 GiB, ¼ vCPU) leaves about 2× headroom; its ¼ vCPU stretches the dev
  server's start from about 9 s to 22 s. lite does not start.
- **`BuildPreviewSandbox` (Build Preview).** 394–437 MiB anon (≤ 459 MiB
  `memory.peak`). **basic** leaves about 2.2× headroom; ready in 18 s at
  ¼ vCPU. lite does not start.
- **Sleep timeouts.** Both previews sleep 10 minutes after their last renewal
  or request. On basic that tail costs about $0.0023 per session; waking a
  Live Preview again costs 12–21 CPU-s (≈ $0.0004), and the author waits
  for the dev server: about 9 s unconstrained, 22 s at ¼ vCPU.
  Builds are destroyed when they finish and have no tail.

## What is configured today

- `wrangler.jsonc`: the three `containers` entries have no `instance_type`;
  Cloudflare's documented default is `lite`
  (<https://developers.cloudflare.com/workers/wrangler/configuration/#containers>).
- Build containers are addressed by `buildId` and destroyed when the build
  ends (`cloudflare-sandbox-vite-theme-build-runner.ts`), so a build is billed
  for its own duration only. Each `exec` has a 120 s budget (`maxDurationMs`
  default), and the start phase has 90 s (`SANDBOX_START_BUDGET_MS`). A
  platform build runs two `vite build` commands (runtime, then preview); a
  native build of a content-dependent Theme runs two passes.
- Live Preview: `sleepAfter` defaults to `"10m"`
  (`cloudflare-sandbox-vite-preview-server.ts`); the open editor renews it
  (`isServing`, observed as a `renew` once a minute), so a Live Preview is
  billed for as long as an editor is open, plus up to 10 minutes.
- Build Preview: `sleepAfter` defaults to `"10m"`
  (`cloudflare-sandbox-build-preview-server.ts`), counted from the last request.
- Image: `Dockerfile.sandbox` on `cloudflare/sandbox:0.12.7`, 1.42 GB
  uncompressed locally; Cloudflare caps image size at the instance's disk
  (lite 2 GB). Toolchain: Vite 7.3.5, wrangler 4.146.0,
  `@cloudflare/vite-plugin` 1.62.4.

## Method

### Environment

WSL2 Ubuntu 22.04 (kernel 6.18.40.1-microsoft-standard-WSL2) with Docker
Desktop 29.8.0 (containerized engine, cgroup v2, cgroupfs driver), 12 vCPU and
15.6 GiB visible to Docker. The machine was shared with other sessions running
`vitest`, measurement scripts and their own E2E runs; the 1-minute load
average ranged from 1.6 to 18 during the measurements and is recorded for
every run (sampled every 5 s) and every replay.

### Driving the real containers

Each run went through the repository's own harness,
`scripts/run-editor-e2e.mjs` with `MORPH_E2E_TRANSPORT=cloudflare-sandbox` and
`MORPH_E2E_PORT=3100`: a fresh D1/R2 state directory, migrations, the seed,
and `vite dev` on Wrangler's default environment, so every build and preview
ran in a real local Docker container started by workerd through the Sandbox
bindings. `.env.e2e` and `.dev.vars` were generated per run (random
credentials and auth secret, `PUBLIC_URL`, the local Theme Worker origin, and
`MORPH_NATIVE_START_BUILD=1` for the native runs) and deleted afterwards; no
Cloudflare credential was present. Each run waited for `/tmp/wait-e2e-free.sh`
to print `FREE`.

Two temporary Playwright specs drove the workloads. They were copied into
`e2e/` for each run, deleted after it, and are **not** part of this change:

- **Build run** (`SIZING_ROUNDS=3`): open the editor (the shared `openEditor`
  helper, which waits for the rendered preview), then three times: type a
  fresh marker into the hero (`editHero`), press the toolbar Build, wait for
  `data-build-pending` to return to `false`, wait for the isolated Build
  Preview to show the marker, fire 15 rounds of parallel `fetch`es from inside
  the preview frame (platform: `/`, `/products`, `/_morph/content?path=%2F`;
  native: `/`, `/native-check`, `/native-ssg`, `/_morph/content?path=%2F`),
  close it and wait 20 s. For native runs the spec first saves the four files
  of the `native-publish-acceptance.spec.ts` fixture (its own `vite.config.ts`
  that prerenders `/native-ssg`, `wrangler.jsonc`, the SSR route and the
  prerendered route, both reading the home page's CMS content).
- **Live Preview run** (`SIZING_ROUNDS=5`): open the editor, stay idle 180 s,
  then five rounds of a content edit (`editHero`) followed by a source edit
  (append an element to the hero component in Code, save with Ctrl+S, wait
  for it on the canvas), revert the source edits, then stay idle 60 s.

Marks with millisecond timestamps were printed at every phase boundary.

### Sampling

- A helper container started with `--cgroupns=host` (on an image unrelated to
  the Sandbox image; see "Incidents") read
  `/sys/fs/cgroup/docker/<id>/{memory.current,memory.peak,memory.stat,cpu.stat}`
  for every container about once a second.
- `docker stats --no-stream` about once a second, `docker events` for
  create/start/kill/destroy times and names, `/proc/loadavg` every 5 s, and
  `uptime` at the start and end of every run.
- Definitions used below:
  - **anon** — `memory.stat` `anon`: process memory that cannot be
    reclaimed; the number an OOM decision is made against. Maximum of the
    ~1 s samples, so a spike shorter than a second can be missed.
  - **`memory.peak`** — the kernel's high-water mark of the whole cgroup,
    including page cache; exact, an upper bound.
  - **CPU-s** — `cpu.stat` `usage_usec` over the container's life or window.
  - **max cores** — the highest CPU rate over one sampling interval.
- Locally every Sandbox container comes with a second container,
  `…-proxy` (`cloudflare/proxy-everything`), which is Wrangler's emulation of
  the outbound interception. It stayed at 8.4–9.4 MiB anon and under 0.7
  CPU-s over its life, does not exist as part of the instance on Cloudflare,
  and is excluded from every number here.

### Replays under limits

To see what happens at each instance size without deploying, the exact
workloads were captured from real runs and replayed under `docker run
--memory=<m> --memory-swap=<m>` (no swap) and `--cpus=<n>`:

- **Builds.** While a real build ran, a watcher recorded each `vite build`
  process of the build container (argv, cwd, full environment) and a tar of
  `/workspace` without the toolchain link. The replay extracts the tar into a
  copy of the Sandbox image and runs the captured commands in order with
  `env -i <captured environment>`, each under `timeout 120` to mirror the
  runner's per-command budget. The native replay clears and re-extracts the
  workspace between passes, as the runner does. Peak memory, OOM kills and
  CPU are read from the replay container's own cgroup.
- **Previews.** The same for the Live Preview's `vite` dev server (port 5173)
  and the Build Preview's `wrangler dev` (port 8788), captured 20 s after
  they started. The replay starts the server under the limits, waits for it
  to answer, then loads the page in Chromium three times in fresh contexts
  (Live Preview: `/__morph-theme-preview__/`; Build Preview: `/` and
  `/products`) and reads the cgroup.

Instance types were modelled as: lite = 256m / 0.0625, basic = 1g / 0.25,
standard-1 = 4g / 0.5, standard-2 = 6g / 1, standard-3 = 8g / 2. Docker's
`--cpus` is a hard CFS quota; whether Cloudflare enforces vCPU the same way is
not something a local run can show (see "Limits").

The replays were validated against the real runs: unconstrained at host load
5, the platform replay peaked at 1,685 MiB with 55.5 CPU-s (real:
1,316–1,759 MiB, 62–87 CPU-s), the native replay at 1,605 MiB with 97.6
CPU-s (real: 1,636–1,914 MiB, 85–104 CPU-s); a second pair at host load
11–13 peaked at 1,480 and 1,673 MiB with 100.1 and 117.2 CPU-s. The Live
Preview server replay peaked at 444 MiB and the Build Preview server at
426 MiB (real containers: 487–513 and 432–459 MiB, which include the
control server).

### The container's own base

An idle container of the image (default entrypoint, no workload) measured
62–66 MiB anon after 60 s (three runs): `/container-server/sandbox` at
~15.5 MiB and six pre-started `node_executor.js` interpreters
(`JAVASCRIPT_POOL_MIN_SIZE=3`, `TYPESCRIPT_POOL_MIN_SIZE=3` in the base
image) at ~7.8 MiB each; `memory.peak` 79–80 MiB; 1.0–1.9 CPU-s in the first
minute. Per-process RSS inside a running container adds up to roughly twice
the cgroup's anon, because shared pages are counted once per process; only
the cgroup numbers are used for sizing.

## Results

Runs used: `platform-2`, `platform-3` (platform builds, three each),
`native-1`, `native-2` (native builds, three each), `native-c` (one native
build, a clean run whose capture watcher had died), `live-1`, `live-2`,
`live-3` (Live Preview). Every build run also produced Live Preview and Build
Preview numbers. `platform-3` overlapped with build replays of this study and
with other sessions' work (load up to 18), and its first Live Preview and
Build Preview containers were each read once with `docker exec … tar` for the
preview replays; its third build is the slowest row below and its third
Build Preview never started. `live-2` took a
`ps` snapshot inside the container every 30 s, which adds a little CPU, and
overlapped with CPU-capped build replays (¼ and 1/16 vCPU).
Not used: `platform-1` (the specs failed before any build; see "Incidents")
and three capture runs, whose build containers were entered with `docker
exec` to read processes and tar the workspace.

### Builds, in the real `Sandbox` containers

"Runner s" is the build service's own `storefront.theme.build.timings`
`runner.durationMs`; "life s" is the container from create to destroy.

| Run        | Build    | #   | Runner s | Life s | Max anon MiB | `memory.peak` MiB | CPU-s | Max cores | Host load (1 min) |
| ---------- | -------- | --- | -------- | ------ | ------------ | ----------------- | ----- | --------- | ----------------- |
| platform-2 | platform | 0   | 48.7     | 46.6   | 1,424        | 1,526             | 67.5  | 2.60      | 2.6–7.4           |
| platform-2 | platform | 1   | 44.9     | 43.7   | 1,563        | 1,664             | 62.5  | 2.42      | 2.6–7.4           |
| platform-2 | platform | 2   | 54.7     | 52.9   | 1,683        | 1,759             | 77.2  | 2.47      | 2.6–7.4           |
| platform-3 | platform | 0   | 65.8     | 62.4   | 1,643        | 1,749             | 86.8  | 2.39      | 5.5–18.3          |
| platform-3 | platform | 1   | 61.2     | 58.7   | 1,585        | 1,658             | 81.9  | 2.46      | 5.5–18.3          |
| platform-3 | platform | 2   | 99.9     | 97.1   | 1,230        | 1,316             | 119.1 | 2.24      | 5.5–18.3          |
| native-1   | native   | 0   | 65.9     | 63.8   | 1,784        | 1,914             | 90.0  | 2.65      | 3.0–7.2           |
| native-1   | native   | 1   | 62.7     | 61.2   | 1,540        | 1,644             | 85.5  | 2.42      | 3.0–7.2           |
| native-1   | native   | 2   | 69.2     | 67.6   | 1,639        | 1,713             | 94.8  | 2.42      | 3.0–7.2           |
| native-c   | native   | 0   | 76.9     | 75.0   | 1,500        | 1,681             | 103.9 | 2.21      | 6.1–10.0          |
| native-2   | native   | 0   | 63.5     | 61.9   | 1,490        | 1,636             | 85.9  | 2.46      | 2.2–5.7           |
| native-2   | native   | 1   | 62.8     | 60.3   | 1,738        | 1,819             | 85.4  | 2.25      | 2.2–5.7           |
| native-2   | native   | 2   | 67.6     | 65.8   | 1,582        | 1,744             | 91.7  | 2.52      | 2.2–5.7           |

Unconstrained, a build uses 2.2–2.65 cores at its busiest second and about
1.4 cores on average over the container's life. It is CPU-bound, not
I/O-bound: limited to one vCPU, its steps take about as many seconds as it
has CPU-seconds.

### Builds, replayed under limits

"Steps" is each captured command's exit status and wall time in order
(platform: runtime build, preview build; native: pass 1, pass 2); 124 is the
120 s timeout, 137 the OOM killer, 134 V8's `JavaScript heap out of memory`
abort. "Invalid" rows were killed from outside (see "Incidents") and were
repeated.

| Build    | Replay             | memory | cpus   | per-step timeout | steps rc/wall       | total s | memory.peak MiB | oom_kill | CPU s | load 1m | result  |
| -------- | ------------------ | ------ | ------ | ---------------- | ------------------- | ------- | --------------- | -------- | ----- | ------- | ------- |
| platform | inst-basic         | 1g     | 0.25   | 120s             | 124/121s, 0/68s     | 188     | 597             | 0        | 46.9  | 3.98    | FAIL    |
| platform | inst-basic-r2      | 1g     | 0.25   | 120s             | 124/120s, 0/84s     | 205     | 603             | 0        | 51.2  | 9.72    | FAIL    |
| platform | inst-lite          | 256m   | 0.0625 | 120s             | 137/69s, 137/64s    | 133     | 256             | 2        | 8.4   | 3.60    | FAIL    |
| platform | inst-standard-1    | 4g     | 0.5    | 120s             | 0/83s, 0/19s        | 101     | 1140            | 0        | 50.8  | 3.06    | pass    |
| platform | inst-standard-1-r2 | 4g     | 0.5    | 120s             | 124/121s, 0/33s     | 154     | 1312            | 0        | 77.0  | 7.70    | FAIL    |
| platform | inst-standard-1-r3 | 4g     | 0.5    | 120s             | 0/88s, 0/18s        | 106     | 1428            | 0        | 52.9  | 6.40    | pass    |
| platform | inst-standard-2    | 6g     | 1      | 120s             | 0/40s, 0/9s         | 50      | 1125            | 0        | 49.6  | 5.22    | pass    |
| platform | inst-standard-2-r2 | 6g     | 1      | 120s             | 0/99s, 0/25s        | 124     | 1493            | 0        | 119.9 | 15.37   | pass    |
| platform | inst-standard-2-r3 | 6g     | 1      | 120s             | 0/65s, 0/12s        | 77      | 1501            | 0        | 76.5  | 8.26    | pass    |
| platform | inst-standard-3-r3 | 8g     | 2      | 120s             | 0/42s, 0/10s        | 51      | 1490            | 0        | 70.0  | 3.72    | pass    |
| platform | mem-1g             | 1g     | none   | 600s             | 0/49s, 0/7s         | 57      | 690             | 0        | 91.3  | 8.40    | pass    |
| platform | mem-256m           | 256m   | none   | 600s             | 137/5s, 137/4s      | 8       | 256             | 2        | 10.3  | 6.34    | FAIL    |
| platform | mem-4g             | 4g     | none   | 600s             | 0/42s, 0/10s        | 52      | 1524            | 0        | 71.0  | 9.57    | pass    |
| platform | mem-512m           | 512m   | none   | 600s             | 134/30s, 134/20s    | 50      | 441             | 0        | 51.4  | 13.84   | FAIL    |
| platform | mem-768m           | 768m   | none   | 600s             | 0/57s, 0/8s         | 66      | 586             | 0        | 143.0 | 10.88   | pass    |
| platform | unlimited-1        | none   | none   | 600s             | 0/32s, 0/6s         | 38      | 1685            | 0        | 55.5  | 5.40    | pass    |
| platform | unlimited-2        | none   | none   | 600s             | 0/67s, 0/10s        | 77      | 1480            | 0        | 100.1 | 10.61   | pass    |
| native   | inst-basic         | 1g     | 0.25   | 120s             | 124/120s, 124/120s  | 241     | 711             | 0        | 60.1  | 8.35    | FAIL    |
| native   | inst-basic-r2      | 1g     | 0.25   | 120s             | 124/121s, 124/120s  | 242     | 630             | 0        | 60.5  | 13.45   | FAIL    |
| native   | inst-lite          | 256m   | 0.0625 | 120s             | 137/78s, 137/74s    | 152     | 256             | 2        | 9.5   | 3.15    | FAIL    |
| native   | inst-standard-1    | 4g     | 0.5    | 120s             | killed from outside | –       | –               | –        | –     | 2.83    | invalid |
| native   | inst-standard-1-r2 | 4g     | 0.5    | 120s             | 124/120s, 124/121s  | 242     | 1504            | 0        | 121.0 | 5.99    | FAIL    |
| native   | inst-standard-1-r3 | 4g     | 0.5    | 120s             | 0/92s, 0/99s        | 191     | 1585            | 0        | 95.3  | 3.06    | pass    |
| native   | inst-standard-2    | 6g     | 1      | 120s             | 0/42s, 0/41s        | 83      | 1656            | 0        | 82.6  | 3.36    | pass    |
| native   | inst-standard-2-r2 | 6g     | 1      | 120s             | 0/85s, 0/100s       | 185     | 1650            | 0        | 177.6 | 9.24    | pass    |
| native   | inst-standard-2-r3 | 6g     | 1      | 120s             | 0/64s, 0/56s        | 121     | 1609            | 0        | 120.3 | 9.04    | pass    |
| native   | inst-standard-3-r3 | 8g     | 2      | 120s             | 0/65s, 0/48s        | 113     | 1622            | 0        | 141.6 | 7.14    | pass    |
| native   | mem-1g             | 1g     | none   | 600s             | 0/51s, 0/47s        | 98      | 841             | 0        | 152.7 | 9.97    | pass    |
| native   | mem-256m           | 256m   | none   | 600s             | 137/3s, 137/2s      | 5       | 256             | 2        | 8.1   | 8.09    | FAIL    |
| native   | mem-4g             | 4g     | none   | 600s             | 0/34s, 0/42s        | 75      | 1607            | 0        | 107.0 | 7.97    | pass    |
| native   | mem-512m           | 512m   | none   | 600s             | 134/23s, 134/23s    | 47      | 512             | 0        | 61.8  | 14.89   | FAIL    |
| native   | mem-768m           | 768m   | none   | 600s             | 0/52s, 0/43s        | 95      | 703             | 0        | 191.5 | 8.00    | pass    |
| native   | unlimited-1        | none   | none   | 600s             | 0/38s, 0/31s        | 69      | 1605            | 0        | 97.6  | 4.96    | pass    |
| native   | unlimited-2        | none   | none   | 600s             | 0/45s, 0/41s        | 86      | 1673            | 0        | 117.2 | 13.47   | pass    |

Reading the table:

- **lite (256 MiB)** — OOM-killed in both steps of both builds, with or
  without the CPU limit.
- **512 MiB** — both builds abort with `JavaScript heap out of memory`.
- **768 MiB / 1 GiB, no CPU limit** — both pass, peaking at 586–841 MiB;
  see finding 1 for the CPU cost.
- **basic (1 GiB, ¼ vCPU)** — memory is fine (597–711 MiB) but the first
  step of the platform build and both native passes hit the 120 s timeout,
  in both repetitions.
- **standard-1 (4 GiB, ½ vCPU)** — passed three times (host load 3.1, 6.4,
  3.1: platform first step 83 s and 88 s; native passes 92 s and 99 s, i.e.
  up to 83 % of the budget) and failed twice (host load 7.7 and 6.0, 120 s
  timeouts). One native replay was killed from outside and is not counted.
- **standard-2 (6 GiB, 1 vCPU)** — passed all six; the longest step took
  100 s (native pass 2, host load 9.2).
- **standard-3 (8 GiB, 2 vCPU)** — passed both. The platform build took
  about as long as standard-2's quietest replay and the native build longer,
  at a higher host load: a second vCPU showed no benefit on this host.

### Live Preview (`PreviewSandbox`)

The container starts during the run's first editor open (the transport
precondition spec) and the peak always falls in its first 19–35 s, while Vite
starts and the editor loads the preview's modules. "Start" is from the
container's first sample to the spec's `preview-ready` mark.

| Run        | Start s | Start CPU-s | Start max cores | Max anon MiB (= start) | `memory.peak` MiB | Life s | Life CPU-s | Host load |
| ---------- | ------- | ----------- | --------------- | ---------------------- | ----------------- | ------ | ---------- | --------- |
| platform-2 | 21      | 12.3        | 2.55            | 475                    | 507               | 286    | 26.6       | 2.6–7.4   |
| platform-3 | 27      | 15.3        | 1.65            | 449                    | 498               | 484    | 42.4       | 5.5–18.3  |
| native-1   | 25      | 18.6        | 2.05            | 473                    | 513               | 331    | 35.0       | 3.0–7.2   |
| native-c   | 30      | 20.9        | 2.19            | 446                    | 501               | 149    | 27.9       | 6.1–10.0  |
| native-2   | 24      | 18.8        | 2.15            | 448                    | 487               | 328    | 34.3       | 2.2–5.7   |
| live-1     | 35      | 19.2        | 2.05            | 458                    | 494               | 372    | 38.3       | 4.3–12.2  |
| live-2     | 29      | 15.3        | 2.04            | 467                    | 504               | 340    | 37.2       | 3.1–9.9   |
| live-3     | 19      | 12.6        | 1.82            | 475                    | 510               | 342    | 31.1       | 1.5–6.6   |

The Live Preview runs, phase by phase (idle = 30 s after `preview-ready` to
the end of the 180 s idle; edit loop = five content edits and five source
edits plus the revert; post-idle = the last 60 s):

| Run    | Idle anon MiB | Idle CPU                       | Edit-loop max anon MiB | Edit-loop CPU      | Edit-loop max cores | Post-idle anon MiB | Post-idle CPU |
| ------ | ------------- | ------------------------------ | ---------------------- | ------------------ | ------------------- | ------------------ | ------------- |
| live-1 | 376–378       | 6.7 CPU-s / 149 s = 0.045 vCPU | 383                    | 7.0 / 95 s = 0.074 | 0.35                | 383                | 0.045         |
| live-2 | 373–376       | 7.6 / 149 s = 0.051            | 381                    | 6.9 / 69 s = 0.099 | 0.54                | 381                | 0.055         |
| live-3 | 377–422       | 6.6 / 150 s = 0.044            | 381                    | 6.5 / 80 s = 0.082 | 0.30                | 381                | 0.045         |

Editing does not raise memory: after the start-up peak the container settles
about 80–95 MiB lower and grows by only a few MiB through the edit loop. Each
source edit cost 0.6–1.5 CPU-s in the container, each content edit
0.04–0.24 CPU-s. In `live-2`'s
snapshots the idle CPU was split about evenly between
`/container-server/sandbox` and the Vite process.

### Build Preview (`BuildPreviewSandbox`)

"Start" is from the container's first sample to the build's marker being
visible in the preview frame; "serving" is the 45-request burst (15 rounds of
3–4 parallel requests); "after" is the following 20 s.

| Run        | Build    | #   | Start s | Start max anon MiB | Start CPU-s | Serving max anon MiB | Serving CPU-s / wall | Serving max cores | After: anon MiB | After: vCPU | `memory.peak` MiB | Host load |
| ---------- | -------- | --- | ------- | ------------------ | ----------- | -------------------- | -------------------- | ----------------- | --------------- | ----------- | ----------------- | --------- |
| platform-2 | platform | 0   | 4       | 400                | 5.3         | 407                  | 1.8 / 4 s            | 0.51              | 414             | 0.045       | 433               | 2.6–7.4   |
| platform-2 | platform | 1   | 5       | 399                | 4.4         | 408                  | 1.7 / 4 s            | 0.50              | 413             | 0.052       | 433               | 2.6–7.4   |
| platform-2 | platform | 2   | 4       | 394                | 5.2         | 409                  | 1.7 / 4 s            | 0.52              | 411             | 0.027       | 432               | 2.6–7.4   |
| platform-3 | platform | 0   | 4       | 394                | 5.3         | 407                  | 2.8 / 6 s            | 0.66              | 408             | 0.100       | 457               | 5.5–18.3  |
| platform-3 | platform | 1   | 5       | 394                | 6.4         | 410                  | 2.7 / 7 s            | 0.56              | 415             | 0.100       | 441               | 5.5–18.3  |
| platform-3 | platform | 2   | –       | –                  | –           | –                    | –                    | –                 | –               | –           | (failed to start) | 5.5–18.3  |
| native-1   | native   | 0   | 4       | 412                | 4.5         | 425                  | 1.5 / 3 s            | 0.55              | 424             | 0.047       | 449               | 3.0–7.2   |
| native-1   | native   | 1   | 3       | 407                | 3.9         | 437                  | 1.5 / 3 s            | 0.51              | 428             | 0.042       | 457               | 3.0–7.2   |
| native-1   | native   | 2   | 4       | 407                | 4.7         | 430                  | 1.4 / 3 s            | 0.53              | 431             | 0.045       | 452               | 3.0–7.2   |
| native-c   | native   | 0   | 4       | 412                | 4.8         | 427                  | 1.9 / 4 s            | 0.55              | 429             | 0.047       | 459               | 6.1–10.0  |
| native-2   | native   | 0   | 4       | 414                | 4.8         | 428                  | 1.5 / 3 s            | 0.48              | 431             | 0.046       | 459               | 2.2–5.7   |
| native-2   | native   | 1   | 3       | 408                | 4.3         | 426                  | 1.8 / 4 s            | 0.50              | 431             | 0.041       | 451               | 2.2–5.7   |
| native-2   | native   | 2   | 4       | 412                | 4.4         | 426                  | 1.8 / 5 s            | 0.50              | 431             | 0.028       | 452               | 2.2–5.7   |

Serving barely moves memory (+5–30 MiB over the start) and costs about half
a core for a few seconds. The native Theme's Build Preview runs about 20 MiB
higher than the starter's.

### Previews, replayed under limits

| server        | replay      | memory | cpus   | ready s | loads (path status)           | memory.peak MiB | anon at end MiB | CPU s | container after               | load 1m |
| ------------- | ----------- | ------ | ------ | ------- | ----------------------------- | --------------- | --------------- | ----- | ----------------------------- | ------- |
| Build Preview | basic       | 1g     | 0.25   | 18.4    | / 200, /products 500          | 403             | 375             | 5.3   | true oomkilled=false exit=0   | 9.49    |
| Build Preview | lite        | 256m   | 0.0625 | never   | –                             | –               | –               | –     | false oomkilled=true exit=0   | 10.71   |
| Build Preview | mem256      | 256m   | none   | never   | –                             | –               | –               | –     | false oomkilled=true exit=0   | 14.62   |
| Build Preview | mem512      | 512m   | none   | 6.5     | / 200, /products 500          | 380             | 356             | 10.6  | true oomkilled=false exit=0   | 15.98   |
| Build Preview | unlimited-1 | none   | none   | 15.0    | / 200, /products 500          | 426             | 381             | 16.3  | true oomkilled=false exit=0   | 13.44   |
| Live Preview  | basic       | 1g     | 0.25   | 22.1    | /**morph-theme-preview**/ 200 | 419             | 386             | 9.0   | true oomkilled=false exit=0   | 13.64   |
| Live Preview  | lite        | 256m   | 0.0625 | never   | –                             | –               | –               | –     | false oomkilled=true exit=137 | 17.87   |
| Live Preview  | mem256      | 256m   | none   | never   | –                             | –               | –               | –     | false oomkilled=true exit=137 | 14.99   |
| Live Preview  | mem512      | 512m   | none   | 10.0    | /**morph-theme-preview**/ 200 | 417             | 383             | 16.9  | true oomkilled=false exit=0   | 13.51   |
| Live Preview  | unlimited-1 | none   | none   | 8.8     | /**morph-theme-preview**/ 200 | 444             | 403             | 13.0  | true oomkilled=false exit=0   | 14.56   |

Both preview servers are OOM-killed at 256 MiB before they answer a request,
with or without lite's CPU limit. Both run at 512 MiB and at basic; at
basic's ¼ vCPU the Live Preview's dev server took 22 s to answer (8.8–10 s
without a CPU limit) and the Build Preview's 18 s.

## Cost model

Published prices (Workers Paid, <https://developers.cloudflare.com/containers/pricing/>,
read 2026-10-08), beyond the included monthly 25 GiB-hours of memory, 375
vCPU-minutes and 200 GB-hours of disk:

- memory $0.0000025 per GiB-second, on the **provisioned** size while running;
- CPU $0.000020 per vCPU-second, on **active use** only;
- disk $0.00000007 per GB-second, provisioned.

Per instance type, the provisioned part costs per running hour: lite
$0.0028, basic $0.0100, standard-1 $0.0380, standard-2 $0.0570, standard-3
$0.0760, standard-4 $0.1130 (memory + disk). CPU adds $0.072 per vCPU-hour
actually used.

### Per build

A build container lives for its build and is destroyed, so it is billed for
`T` seconds of its provisioned memory and disk plus the CPU it used.
`T` = the replay's step time at that size + 10 s for start, workspace writes
and output collection (in the real runs the container lived 6–15 s longer
than the replayed `vite build` steps took). Rows are the replays that passed,
at the host load they ran under; cold start on Cloudflare is not included.

| Build    | Instance   | Host load | Steps s | `T` s | CPU-s | Memory $ | CPU $   | Disk $  | **Per build $** |
| -------- | ---------- | --------- | ------- | ----- | ----- | -------- | ------- | ------- | --------------- |
| platform | standard-1 | 3.1       | 101     | 111   | 50.8  | 0.00111  | 0.00102 | 0.00006 | **0.0022**      |
| platform | standard-1 | 6.4       | 106     | 116   | 52.9  | 0.00116  | 0.00106 | 0.00006 | **0.0023**      |
| platform | standard-2 | 5.2       | 50      | 60    | 49.6  | 0.00090  | 0.00099 | 0.00005 | **0.0019**      |
| platform | standard-2 | 8.3       | 77      | 87    | 76.5  | 0.00131  | 0.00153 | 0.00007 | **0.0029**      |
| platform | standard-3 | 3.7       | 51      | 61    | 70.0  | 0.00122  | 0.00140 | 0.00007 | **0.0027**      |
| native   | standard-1 | 3.1       | 191     | 201   | 95.3  | 0.00201  | 0.00191 | 0.00011 | **0.0040**      |
| native   | standard-2 | 3.4       | 83      | 93    | 82.6  | 0.00140  | 0.00165 | 0.00008 | **0.0031**      |
| native   | standard-2 | 9.0       | 121     | 131   | 120.3 | 0.00197  | 0.00241 | 0.00011 | **0.0045**      |
| native   | standard-3 | 7.1       | 113     | 123   | 141.6 | 0.00246  | 0.00283 | 0.00014 | **0.0054**      |

So roughly **$0.002–0.003 per platform build and $0.003–0.005 per native
build**, with CPU about half of it. A larger instance does not make a build
cheaper: the CPU-seconds stay about the same or rise, and memory is billed on
the larger provisioned size for a shorter time. standard-1 costs about the
same as standard-2 per build but runs close to the 120 s timeout. Cloudflare
also accepts custom instance types of at least 1 vCPU with at least 3 GiB per
vCPU; 1 vCPU / 3 GiB would halve the memory column of the standard-2 rows,
and the measurements show 3 GiB is more than a build needs (at most 1.9 GiB
`memory.peak` unconstrained, under 0.9 GiB at a 1 GiB limit).

The free allowance covers, per month, about 22,500 CPU-seconds — on the order
of 200–450 builds — and 90,000 GiB-seconds, about 115–250 standard-2 builds
if nothing else used it.

### Per Live Preview editing hour

The Live Preview runs while an editor is open (the editor renews it) and for
up to `sleepAfter` (10 minutes) after the last renewal. Measured active CPU
was 0.044–0.055 vCPU while idle and 0.07–0.10 vCPU averaged over the edit
loop, plus 12–21 CPU-s to start. On **basic** (1 GiB, 4 GB disk):

| Average active CPU over the hour | Memory + disk $ | CPU $  | **Per editor-open hour $** |
| -------------------------------- | --------------- | ------ | -------------------------- |
| 0.045 vCPU (idle editor)         | 0.0100          | 0.0032 | **0.013**                  |
| 0.07 vCPU                        | 0.0100          | 0.0050 | **0.015**                  |
| 0.10 vCPU (continuous editing)   | 0.0100          | 0.0072 | **0.017**                  |

Add about **$0.0004 per start** (12–21 CPU-s) and about **$0.0023 per
session end** for the 10-minute `sleepAfter` tail at idle CPU. The same hour
on standard-1 would be $0.041–0.045, almost all of it provisioned memory.
At these rates the idle polling alone (≈0.045 vCPU) is about $0.003 per hour,
a quarter of the hour's cost on basic.

### Per Build Preview view

A Build Preview starts on first view (4–6 CPU-s), serves cheaply (a 45-request
burst cost 1.4–2.8 CPU-s) and idles at 0.03–0.10 vCPU until 10 minutes after
the last request. On basic, a 5-minute look plus the 10-minute tail is about
**$0.0035**; the 10-minute tail alone is about $0.0023.

Not included: Worker requests and CPU, Durable Object requests and duration
(each container has one), R2, Queues, egress, logs.

## Limits of local measurement

- **CPU is the uncertain dimension.** The host was shared and its load moved
  CPU-seconds by up to 2× for identical work. Cloudflare's vCPU is not this
  machine's vCPU, and whether an instance can exceed its vCPU share briefly is
  not observable locally; the replays assume a hard quota. Whether a build
  fits the 120 s budget at standard-1 is therefore unresolved by this data:
  it passed using 69–83 % of the budget at host load 3–6 and failed at
  6.0–7.7.
- **Memory is the reliable dimension**, with one caveat: Node sizes its heap
  from the memory it can see. Locally that was the cgroup limit; if a
  Cloudflare instance exposes more memory than its type allows, a build could
  grow past the limit instead of collecting harder.
- One sample a second can miss short anon spikes; `memory.peak` cannot, and
  is reported next to it.
- Container start, image pull and placement on Cloudflare are not measured;
  locally the image is already present. Billable time for a build will be
  longer than the local wall time by Cloudflare's cold start.
- The `…-proxy` sidecar and the outbound interception are local emulations.
- Only the starter Theme and the native fixture were built. Larger Themes,
  more routes or more dependencies will move the build numbers.
- Disk use was not measured beyond the image size (1.42 GB); every type from
  lite up has at least 2 GB.
- The Build Preview's `/products` answered 500 in the real runs and in the
  replays alike (no catalog source inside the Build Preview); it is a request
  the Worker served, but not a rendered product page.

## Incidents during measurement

- The first platform run used `publish.spec.ts` and
  `build-preview-isolated.spec.ts`; both failed in `enableSelection` while the
  canvas still showed "Loading React preview…", before any build, so the
  temporary build spec was written to wait through `openEditor` first. This
  was not investigated further.
- The Build Preview container failed to start twice, with
  `SandboxError: Container failed to start`, at host load 11–12 and 14–16;
  one ended `platform-3` round 2's preview, the other was in an aborted
  capture run.
- Helper containers on the Sandbox image, or on an image committed from it,
  were killed at the instant a dev server on the machine stopped, along with
  that server's own containers; a helper on an unrelated image never was.
  This looks like Wrangler's dev teardown selecting containers by image, and
  it can reach containers of other sessions. The sampler moved to an
  unrelated image and the replays to a flattened copy of the Sandbox image
  (`docker export | docker import`); the replays killed from outside before
  that are listed as invalid and were repeated.
- One capture run was aborted by a mistake in its wrapper; its orphaned dev
  server process group and the two containers it had started were stopped
  and removed by id, and its data is not used.
- Runs whose containers were touched by a capture or snapshot (`docker exec`
  of a tar or `ps`) are marked where they are used.

## Reproduction

The tools and raw logs are on the measuring machine under
`~/sizing-2026-10/` (`tools/`, one directory per run under `runs/`, captures
and replay results under `capture/`). They are not committed. The method
above is enough to repeat the measurement; the expensive parts are one E2E
slot per run (about 6–9 minutes) and, for replays, about 2–4 minutes per
size.
