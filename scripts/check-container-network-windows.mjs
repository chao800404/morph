// @ts-check
/**
 * Stage 3's per-window network check (v3 plan, "網路窗口"), and the clock
 * probe it rests on.
 *
 * A container job runs its runner invocations (two in editor-e2e-container,
 * the default; the other Stage 3 jobs name theirs on the `check` command
 * line) under one interface monitor (`ip -ts -o monitor link address`) and
 * marks each one's window in windows.ndjson. The job-wide link-local step
 * only knows that the whole job saw a veth and that no veth got an fe80
 * address. This checker asks the same
 * of each window: container veths were created and deleted inside it, none
 * lives across a window edge or between windows, and none got an IPv6
 * link-local address (#382).
 *
 * That comparison is only meaningful if `ip -ts` (local time, no zone) and the
 * markers (`date -u`) read the same clock, which the plan says must be shown
 * before any window becomes a hard gate. So at each marker the job also takes
 * a clock probe: it creates and deletes a probe link between two UTC
 * readings, and asks the Docker daemon for its time between two more. The
 * check fails unless every probe link is seen by the monitor, and the
 * monitor's and the daemon's times both fall inside their readings, give or
 * take CLOCK_BOUND_MS. A record that is missing, unparseable or out of order
 * fails as such: absence never passes.
 *
 *   node scripts/check-container-network-windows.mjs probe <marker> <dir>
 *   node scripts/check-container-network-windows.mjs check <dir> [<window>...]
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every runner window a container job may mark, one per container target
 * invocation. A job names its own windows, in order, on the `check` command
 * line; a marker or window not listed here is refused.
 */
export const KNOWN_WINDOWS = Object.freeze([
  "lifecycle",
  "preview-access",
  "b1-publish-rollback",
  "navigation-matrix-public",
  "section-visibility-layout",
  "native-ssr-publish",
  "native-publish",
  "starter-upgrade-publish",
  "starter-v32-full-start",
  "native-compat-published",
  "preview-socket",
  "start-container-content-sync",
  "starter-upgrade-case-e",
  "preview-start-two-tab-race",
  "native-content-dependency",
]);
const KNOWN_MARKERS = Object.freeze(
  KNOWN_WINDOWS.flatMap((name) => [`${name}-start`, `${name}-end`]),
);

/**
 * The windows of one job in order, each as its start and end marker.
 * @param {readonly string[]} names
 */
export function windowsFor(names) {
  if (!Array.isArray(names) || names.length === 0) {
    failed("NETWORK_BAD_WINDOWS", "a job must name at least one window");
  }
  for (const name of names) {
    if (!KNOWN_WINDOWS.includes(name)) {
      failed("NETWORK_BAD_WINDOWS", `unknown window ${name}`);
    }
  }
  if (new Set(names).size !== names.length) {
    failed("NETWORK_BAD_WINDOWS", `a window is named twice: ${names.join(", ")}`);
  }
  return Object.freeze(
    names.map((name) => Object.freeze({ name, start: `${name}-start`, end: `${name}-end` })),
  );
}

/** @param {ReturnType<typeof windowsFor>} windows */
const markersOf = (windows) => Object.freeze(windows.flatMap((w) => [w.start, w.end]));

/** The editor-e2e-container job's windows, the default when none are named. */
export const WINDOWS = windowsFor(["lifecycle", "preview-access"]);
export const MARKERS = markersOf(WINDOWS);

/**
 * The plan sets no number. A wrong clock here is a zone offset (at least
 * 15 minutes) or a stepped clock; a probe's own latency is already inside its
 * two readings. One second is far from both.
 */
export const CLOCK_BOUND_MS = 1_000;
/** A probe belongs to its marker only if taken right after it. */
export const PROBE_AFTER_MARKER_MAX_MS = 10_000;

/** The monitor's probes from the job's link-local steps. */
const MONITOR_START_PROBE = "morphprobe0";
const MONITOR_END_PROBE = "morphprobe2";
const VETH = /^veth[0-9a-f]+$/;

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function failed(code, message) {
  throw new Error(`${code}: ${message}`);
}

/**
 * Microseconds since the epoch from an ISO UTC string with any number of
 * fraction digits, or from `ip -ts`'s zone-less local time read as UTC.
 * @param {string} text
 * @param {{ zone: "Z" | "none" }} options
 */
export function parseMicros(text, { zone }) {
  const pattern =
    zone === "Z"
      ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/
      : /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})$/;
  const match = pattern.exec(text);
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(seconds)) return null;
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return seconds * 1000 + Number(fraction);
}

/**
 * The Docker daemon's SystemTime: RFC 3339 with nanoseconds and the daemon's
 * own zone (`Z` or `+hh:mm`), which is honoured.
 * @param {string} text
 */
export function parseRfc3339Micros(text) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(seconds)) return null;
  return seconds * 1000 + Number((match[2] ?? "").padEnd(6, "0").slice(0, 6));
}

/** @param {number} micros */
function iso(micros) {
  return new Date(Math.floor(micros / 1000)).toISOString();
}

/**
 * How far `micros` lies outside the readings taken before and after it, in
 * microseconds (0 inside). The readings are whole milliseconds, truncated, so
 * the true "after" is up to 1 ms later than written.
 * @param {number} micros @param {number} before @param {number} after
 */
function outside(micros, before, after) {
  if (micros < before) return micros - before;
  if (micros > after + 1000) return micros - (after + 1000);
  return 0;
}

/** @param {string} text @param {string} what */
function ndjson(text, what) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      return failed("NETWORK_BAD_RECORD", `${what} line ${i + 1} is not JSON`);
    }
  });
}

/**
 * @param {string} text
 * @param {ReturnType<typeof windowsFor>} [windows]
 */
export function parseMarkers(text, windows = WINDOWS) {
  const MARKERS = markersOf(windows);
  const records = ndjson(text, "windows.ndjson");
  const names = records.map((r) => r?.name);
  if (JSON.stringify(names) !== JSON.stringify(MARKERS)) {
    failed(
      "NETWORK_BAD_MARKERS",
      `expected markers ${MARKERS.join(", ")} once each in order, got ${names.join(", ") || "none"}`,
    );
  }
  /** @type {Record<string, number>} */
  const at = {};
  for (const record of records) {
    const micros =
      typeof record.utc === "string" ? parseMicros(record.utc, { zone: "Z" }) : null;
    if (micros === null) {
      failed("NETWORK_BAD_MARKERS", `marker ${record.name} has no UTC time`);
    }
    at[record.name] = micros;
  }
  for (let i = 1; i < MARKERS.length; i++) {
    if (!(at[MARKERS[i - 1]] <= at[MARKERS[i]])) {
      failed("NETWORK_BAD_MARKERS", `marker ${MARKERS[i]} is earlier than ${MARKERS[i - 1]}`);
    }
  }
  for (const w of windows) {
    if (!(at[w.start] < at[w.end])) {
      failed("NETWORK_BAD_MARKERS", `window ${w.name} is empty`);
    }
  }
  return at;
}

/**
 * One event per line, as `ip -ts -o monitor link address` prints it:
 * `[<local time>] [Deleted ]<index>: <name>[@<peer>][:] <rest>`.
 * @param {string} text
 */
export function parseMonitorLog(text) {
  const events = [];
  let previous = -Infinity;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const stamped = /^\[([^\]]+)\] (.*)$/.exec(line);
    const micros = stamped ? parseMicros(stamped[1], { zone: "none" }) : null;
    if (!stamped || micros === null) {
      failed("NETWORK_RECORD_UNPARSEABLE", `monitor line ${i + 1} has no timestamp: ${line.slice(0, 80)}`);
    }
    if (micros < previous) {
      failed("NETWORK_RECORD_NOT_MONOTONIC", `monitor line ${i + 1} goes back in time`);
    }
    previous = micros;
    const body = /^(Deleted )?(\d+): ([A-Za-z0-9_.-]+)(?:@[^\s:]+)?:?\s+(.*)$/.exec(stamped[2]);
    if (!body) continue;
    const rest = body[4];
    events.push({
      line: i + 1,
      micros,
      deleted: Boolean(body[1]),
      name: body[3],
      kind: /^inet6? /.test(rest) ? "addr" : "link",
      linkLocal: /^inet6 fe80:/.test(rest),
    });
  }
  return events;
}

/**
 * The whole check: first the clock that makes the monitor's times comparable
 * with the markers (a monitor on another zone fails as that, not as a window
 * that looks empty), then the windows.
 * @param {{ windows: string, monitorLog: string, clockProbes: string }} record
 * @param {{ boundMs?: number, windows?: ReturnType<typeof windowsFor> }} [options]
 */
export function verifyContainerNetworkWindows(
  record,
  { boundMs = CLOCK_BOUND_MS, windows: expected = WINDOWS } = {},
) {
  const markers = parseMarkers(record.windows, expected);
  const events = parseMonitorLog(record.monitorLog);
  const clock = verifyClockProbes(markers, events, record.clockProbes, {
    boundMs,
    windows: expected,
  });
  const windows = verifyWindows(markers, events, expected);
  return { windows, clock };
}

/**
 * Each window's veths, with the monitor shown to cover every window. Times
 * are compared as UTC; only verifyClockProbes shows that is right.
 * @param {Record<string, number>} markers
 * @param {ReturnType<typeof parseMonitorLog>} events
 * @param {ReturnType<typeof windowsFor>} [windows]
 */
export function verifyWindows(markers, events, windows = WINDOWS) {
  const MARKERS = markersOf(windows);
  // The monitor ran across every window: it reported the job's first probe
  // before the first window and its last probe after the last one.
  const startProbe = events.find((e) => e.name === MONITOR_START_PROBE && e.deleted);
  const endProbe = events.find((e) => e.name === MONITOR_END_PROBE && e.deleted);
  const first = markers[MARKERS[0]];
  const last = markers[MARKERS[MARKERS.length - 1]];
  if (!startProbe || startProbe.micros > first) {
    failed("NETWORK_MONITOR_LATE", `the monitor did not report ${MONITOR_START_PROBE} before ${MARKERS[0]}`);
  }
  if (!endProbe || endProbe.micros < last) {
    failed("NETWORK_MONITOR_STOPPED", `the monitor did not report ${MONITOR_END_PROBE} after ${MARKERS[MARKERS.length - 1]}`);
  }

  // fe80 on a container veth, anywhere in the record (#382).
  const linkLocal = events.find((e) => VETH.test(e.name) && e.linkLocal);
  if (linkLocal) {
    failed(
      "NETWORK_VETH_LINK_LOCAL",
      `${linkLocal.name} got an IPv6 link-local address at ${iso(linkLocal.micros)} (monitor line ${linkLocal.line})`,
    );
  }

  /** @param {number} micros */
  const windowOf = (micros) =>
    windows.find((w) => markers[w.start] <= micros && micros <= markers[w.end]) ?? null;

  /** @type {Map<string, typeof events>} */
  const byVeth = new Map();
  for (const event of events) {
    if (!VETH.test(event.name)) continue;
    const list = byVeth.get(event.name) ?? [];
    list.push(event);
    byVeth.set(event.name, list);
  }
  /** @type {Record<string, string[]>} */
  const perWindow = Object.fromEntries(windows.map((w) => [w.name, []]));
  for (const [name, list] of byVeth) {
    const firstEvent = list[0];
    const lastEvent = list[list.length - 1];
    const home = windowOf(firstEvent.micros);
    if (!home) {
      failed("NETWORK_VETH_OUTSIDE_WINDOW", `${name} appeared at ${iso(firstEvent.micros)}, outside every window`);
    }
    if (windowOf(lastEvent.micros) !== home) {
      failed(
        "NETWORK_VETH_SPANS_WINDOWS",
        `${name} appeared in ${home.name} and was last seen at ${iso(lastEvent.micros)}, outside it`,
      );
    }
    const lastLink = [...list].reverse().find((e) => e.kind === "link");
    if (!lastLink?.deleted) {
      failed("NETWORK_VETH_NOT_DELETED", `${name} was created in ${home.name} and never deleted inside it`);
    }
    perWindow[home.name].push(name);
  }
  for (const w of windows) {
    if (perWindow[w.name].length === 0) {
      failed("NETWORK_WINDOW_NO_VETH", `no container veth was created and deleted in the ${w.name} window`);
    }
  }
  return windows.map((w) => ({
    name: w.name,
    start: iso(markers[w.start]),
    end: iso(markers[w.end]),
    veths: perWindow[w.name].length,
  }));
}

/**
 * One clock probe per marker: the monitor's stamp of the probe link and the
 * Docker daemon's time each fall inside the UTC readings taken around them.
 * @param {Record<string, number>} markers
 * @param {ReturnType<typeof parseMonitorLog>} events
 * @param {string} clockProbes
 * @param {{ boundMs?: number, windows?: ReturnType<typeof windowsFor> }} [options]
 */
export function verifyClockProbes(
  markers,
  events,
  clockProbes,
  { boundMs = CLOCK_BOUND_MS, windows = WINDOWS } = {},
) {
  const MARKERS = markersOf(windows);
  const boundMicros = boundMs * 1000;
  // Clock: one probe per marker, in marker order.
  const probes = ndjson(clockProbes, "clock-probes.ndjson");
  const probeMarkers = probes.map((p) => p?.marker);
  if (JSON.stringify(probeMarkers) !== JSON.stringify(MARKERS)) {
    failed(
      "CLOCK_BAD_PROBES",
      `expected one clock probe per marker in order, got ${probeMarkers.join(", ") || "none"}`,
    );
  }
  const clock = [];
  for (const probe of probes) {
    const where = `clock probe at ${probe.marker}`;
    if (probe.ipError) failed("CLOCK_PROBE_FAILED", `${where}: ${probe.ipError}`);
    const read = (/** @type {unknown} */ value, /** @type {string} */ field) => {
      const micros = typeof value === "string" ? parseMicros(value, { zone: "Z" }) : null;
      if (micros === null) failed("CLOCK_BAD_PROBES", `${where}: ${field} is not a UTC time`);
      return /** @type {number} */ (micros);
    };
    const ipBefore = read(probe.ipBefore, "ipBefore");
    const ipAfter = read(probe.ipAfter, "ipAfter");
    const sinceMarker = ipBefore - markers[probe.marker];
    if (sinceMarker < -boundMicros || sinceMarker > PROBE_AFTER_MARKER_MAX_MS * 1000) {
      failed("CLOCK_PROBE_NOT_AT_MARKER", `${where} was taken ${Math.round(sinceMarker / 1000)} ms from its marker`);
    }
    if (typeof probe.link !== "string" || !/^morphclk\d+$/.test(probe.link)) {
      failed("CLOCK_BAD_PROBES", `${where}: no probe link name`);
    }
    const seen = events.find((e) => e.name === probe.link);
    if (!seen) failed("CLOCK_PROBE_UNSEEN", `${where}: the monitor never reported ${probe.link}`);
    const ipSkew = outside(seen.micros, ipBefore, ipAfter);
    if (Math.abs(ipSkew) > boundMicros) {
      failed(
        "CLOCK_SKEW",
        `${where}: the monitor stamped ${probe.link} ${Math.round(ipSkew / 1000)} ms outside the UTC readings around it (bound ${boundMs} ms)`,
      );
    }
    if (probe.dockerError || typeof probe.docker !== "string") {
      failed("CLOCK_DOCKER_UNAVAILABLE", `${where}: ${probe.dockerError ?? "no Docker daemon time"}`);
    }
    const dockerBefore = read(probe.dockerBefore, "dockerBefore");
    const dockerAfter = read(probe.dockerAfter, "dockerAfter");
    const dockerMicros = parseRfc3339Micros(probe.docker);
    if (dockerMicros === null) {
      failed("CLOCK_DOCKER_UNAVAILABLE", `${where}: Docker time ${probe.docker} does not parse`);
    }
    const dockerSkew = outside(dockerMicros, dockerBefore, dockerAfter);
    if (Math.abs(dockerSkew) > boundMicros) {
      failed(
        "CLOCK_DOCKER_SKEW",
        `${where}: the Docker daemon read ${Math.round(dockerSkew / 1000)} ms outside the UTC readings around it (bound ${boundMs} ms)`,
      );
    }
    clock.push({ marker: probe.marker, ipSkewMs: ipSkew / 1000, dockerSkewMs: dockerSkew / 1000 });
  }

  return clock;
}

/**
 * @param {{
 *   now?: () => Date,
 *   run?: (command: string, args: string[]) => { status: number | null, stdout: string, stderr: string, error?: Error },
 * }} [adapters]
 * @param {string} dir
 * @param {string} marker
 */
export function recordClockProbe(dir, marker, adapters = {}) {
  if (!KNOWN_MARKERS.includes(marker)) failed("CLOCK_BAD_PROBES", `unknown marker ${marker}`);
  const now = adapters.now ?? (() => new Date());
  const run =
    adapters.run ??
    ((command, args) => {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 });
      return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
    });
  const file = path.join(dir, "clock-probes.ndjson");
  const index = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").length
    : 0;
  const link = `morphclk${index}`;
  const problem = (/** @type {ReturnType<typeof run>} */ r, /** @type {string} */ what) =>
    r.error ? `${what}: ${r.error.message}` : r.status !== 0 ? `${what} exited ${r.status}: ${r.stderr.trim()}` : null;

  const ipBefore = now().toISOString();
  const add = run("sudo", ["-n", "ip", "link", "add", link, "type", "veth", "peer", "name", `${link}p`]);
  const del = add.status === 0 && !add.error ? run("sudo", ["-n", "ip", "link", "del", link]) : null;
  const ipAfter = now().toISOString();
  const ipError = problem(add, "ip link add") ?? (del ? problem(del, "ip link del") : null);

  const dockerBefore = now().toISOString();
  const info = run("docker", ["info", "--format", "{{json .SystemTime}}"]);
  const dockerAfter = now().toISOString();
  let docker = null;
  let dockerError = problem(info, "docker info");
  if (!dockerError) {
    try {
      docker = JSON.parse(info.stdout.trim());
      if (typeof docker !== "string") throw new Error("not a string");
    } catch {
      docker = null;
      dockerError = `docker info printed ${info.stdout.trim().slice(0, 80)}`;
    }
  }
  const entry = { marker, link, ipBefore, ipAfter, ipError, dockerBefore, dockerAfter, docker, dockerError };
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return entry;
}

/** @param {string} dir */
export function readNetworkRecord(dir) {
  const read = (/** @type {string} */ name) => {
    try {
      return readFileSync(path.join(dir, name), "utf8");
    } catch (error) {
      return failed(
        "NETWORK_RECORD_MISSING",
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  return {
    windows: read("windows.ndjson"),
    monitorLog: read("ip-monitor.log"),
    clockProbes: read("clock-probes.ndjson"),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === "probe" && rest.length === 2) {
      // Records, never decides: the check decides, and a probe that could not
      // be taken is a failure there.
      const entry = recordClockProbe(rest[1], rest[0]);
      if (entry.ipError || entry.dockerError) {
        console.log(`::warning::Clock probe at ${entry.marker} incomplete: ${entry.ipError ?? entry.dockerError}`);
      } else {
        console.log(`Clock probe at ${entry.marker}: ${entry.link} between ${entry.ipBefore} and ${entry.ipAfter}; Docker ${entry.docker}`);
      }
    } else if (mode === "check" && rest.length >= 1) {
      // The job's windows in order; editor-e2e-container's when none are named.
      const [dir, ...names] = rest;
      const windows = names.length > 0 ? windowsFor(names) : WINDOWS;
      const result = verifyContainerNetworkWindows(readNetworkRecord(dir), { windows });
      for (const c of result.clock) {
        console.log(`clock at ${c.marker}: monitor ${c.ipSkewMs} ms, Docker ${c.dockerSkewMs} ms outside its readings`);
      }
      for (const w of result.windows) {
        console.log(`${w.name} window ${w.start} - ${w.end}: ${w.veths} container veths created and deleted inside it, none with a link-local address`);
      }
    } else {
      console.error(
        "Usage: node scripts/check-container-network-windows.mjs probe <marker> <dir> | check <dir> [<window>...]",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
