#!/usr/bin/env node
/**
 * Container diagnostics for the container acceptance job: Docker's own
 * container and network events, and the preview containers' request record
 * (src/lib/storefront/compiler/theme-preview-request-trace.ts), on one clock.
 * Written for the closed container-port connections diagnosed in handoff
 * 2026-10-30; it observes only and decides nothing about the job.
 *
 *   record <dir>        runs until SIGTERM/SIGINT, writing into <dir>
 *   stop <dir> <out>    stops the recorder started on <dir>, copies the
 *                       record to <out>
 *
 * Nothing it writes is taken whole from Docker or a container: each Docker
 * event keeps a fixed set of fields, and from a container's log only lines
 * carrying the request record's marker are read, each reduced to that
 * record's own fields. No label, environment, command line, header, cookie,
 * query or body is kept. Every step that cannot be done is recorded as such;
 * none of them fails the job.
 *
 * A request missing from the container record is not, by itself, a request
 * that never arrived: first rule out the record missing it. recorder.ndjson
 * says which containers were followed, how many log lines each gave in all
 * (counted, never kept) and how many were records, and how reading each log
 * ended; each Vite process writes `trace-start` when its record begins, and
 * the Worker's own start line carries `vite.requestTrace` when it handed
 * Vite the switch.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TRACE_MARKER = "MORPH_PREVIEW_REQUEST_TRACE";

const CLASS_ROLES = new Map([
  ["PreviewSandbox", "preview"],
  ["BuildPreviewSandbox", "build-preview"],
  ["Sandbox", "theme-build"],
]);

/**
 * The container's role, from the name the local runtime gives it:
 * `workerd-<script>-<Class>-<object id>`, and the same with `-proxy` for the
 * egress interceptor beside it.
 */
export function containerRole(name) {
  const match =
    typeof name === "string"
      ? /-(PreviewSandbox|BuildPreviewSandbox|Sandbox)-([0-9a-f]{64})(-proxy)?$/.exec(
          name.replace(/^\//, ""),
        )
      : null;
  if (!match) return { role: "other", objectId: null };
  const role = CLASS_ROLES.get(match[1]);
  return {
    role: match[3] ? `${role}-proxy` : role,
    // The Durable Object id, as the Worker's sandbox log prints sandboxId.
    objectId: match[2].slice(0, 12),
  };
}

const KEPT_ATTRIBUTES = ["name", "image", "exitCode", "signal"];

/**
 * One Docker event, reduced to what the timeline needs. `known` maps a
 * container id to its role, so a network event (whose actor is the network)
 * can name the container it is about.
 */
export function sanitizeDockerEvent(raw, known = new Map()) {
  if (!raw || typeof raw !== "object") return null;
  const type = typeof raw.Type === "string" ? raw.Type : null;
  if (type !== "container" && type !== "network") return null;
  // `exec_start: <command>` carries a command line; keep the action only.
  const action =
    typeof raw.Action === "string" ? raw.Action.split(":", 1)[0].trim() : null;
  const attributes =
    raw.Actor && typeof raw.Actor.Attributes === "object"
      ? (raw.Actor.Attributes ?? {})
      : {};
  const nanos = typeof raw.timeNano === "number" ? raw.timeNano : null;
  const event = {
    t: nanos
      ? new Date(Math.floor(nanos / 1e6)).toISOString()
      : typeof raw.time === "number"
        ? new Date(raw.time * 1000).toISOString()
        : null,
    source: "docker",
    type,
    action,
  };
  if (type === "container") {
    const id = typeof raw.Actor?.ID === "string" ? raw.Actor.ID : "";
    const identity = containerRole(attributes.name);
    if (id && identity.role !== "other") known.set(id, identity);
    const kept = known.get(id) ?? identity;
    event.container = id.slice(0, 12) || null;
    event.role = kept.role;
    event.objectId = kept.objectId;
    for (const key of KEPT_ATTRIBUTES) {
      if (typeof attributes[key] === "string") event[key] = attributes[key];
    }
  } else {
    const id =
      typeof attributes.container === "string" ? attributes.container : "";
    const kept = known.get(id) ?? { role: "other", objectId: null };
    event.container = id.slice(0, 12) || null;
    event.role = kept.role;
    event.objectId = kept.objectId;
    if (typeof attributes.name === "string") event.network = attributes.name;
  }
  return event;
}

const TRACE_FIELDS = {
  t: "string",
  ev: "string",
  pid: "number",
  conn: "number|null",
  peer: "string|null",
  peerPort: "number|null",
  code: "string|null",
  hadError: "boolean",
  peerEndObserved: "boolean",
  requests: "number",
  seq: "number",
  method: "string|null",
  path: "string",
  outcome: "string",
  status: "number|null",
  ms: "number",
  handedBytes: "number",
  deliveredBytes: "string",
};

function fieldMatches(value, spec) {
  return spec
    .split("|")
    .some((type) => (type === "null" ? value === null : typeof value === type));
}

/**
 * One line of a container's log, if it is a request record: its own fields,
 * nothing else. A path keeps no query, whatever the container wrote.
 */
export function parseTraceLine(line) {
  const at = line.indexOf(`${TRACE_MARKER} `);
  if (at === -1) return null;
  let raw;
  try {
    raw = JSON.parse(line.slice(at + TRACE_MARKER.length + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || typeof raw.ev !== "string") {
    return null;
  }
  const kept = {};
  for (const [key, spec] of Object.entries(TRACE_FIELDS)) {
    if (key in raw && fieldMatches(raw[key], spec)) kept[key] = raw[key];
  }
  if (typeof kept.path === "string") {
    kept.path = kept.path.split(/[?#]/, 1)[0];
  }
  if (kept.deliveredBytes !== undefined && kept.deliveredBytes !== "unknown") {
    delete kept.deliveredBytes;
  }
  return kept;
}

function appendLine(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function record(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const eventsFile = path.join(dir, "docker-events.ndjson");
  const requestsFile = path.join(dir, "container-requests.ndjson");
  const statusFile = path.join(dir, "recorder.ndjson");
  const status = (value) =>
    appendLine(statusFile, { t: new Date().toISOString(), ...value });
  fs.writeFileSync(path.join(dir, "recorder.pid"), String(process.pid));

  const known = new Map();
  const followed = new Map();
  const counts = { events: 0, traceLines: new Map(), logLines: new Map() };

  const follow = (id, identity) => {
    if (
      followed.has(id) ||
      !identity.role ||
      identity.role.endsWith("-proxy")
    ) {
      return;
    }
    if (identity.role === "other") return;
    const child = spawn("docker", ["logs", "--follow", id], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    followed.set(id, child);
    let pending = "";
    const read = (chunk) => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        // Counted, never kept: says whether this container's log was read
        // at all, apart from whether it held any record line.
        counts.logLines.set(id, (counts.logLines.get(id) ?? 0) + 1);
        const trace = parseTraceLine(line);
        if (!trace) continue;
        counts.traceLines.set(id, (counts.traceLines.get(id) ?? 0) + 1);
        appendLine(requestsFile, {
          ...trace,
          source: "container",
          container: id.slice(0, 12),
          role: identity.role,
          objectId: identity.objectId,
        });
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (error) =>
      status({
        ev: "follow-error",
        container: id.slice(0, 12),
        code: error.code ?? null,
      }),
    );
    // How reading the log ended: by itself (the container went away) or
    // with an error, before the recorder was stopped.
    child.on("exit", (code, signal) =>
      status({
        ev: "follow-exit",
        container: id.slice(0, 12),
        code,
        signal,
        logLines: counts.logLines.get(id) ?? 0,
      }),
    );
  };

  const events = spawn(
    "docker",
    [
      "events",
      "--format",
      "{{json .}}",
      "--filter",
      "type=container",
      "--filter",
      "type=network",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let pending = "";
  events.stdout.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      let raw;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const event = sanitizeDockerEvent(raw, known);
      if (!event) continue;
      counts.events++;
      appendLine(eventsFile, event);
      if (event.type === "container" && event.action === "start") {
        const id = raw.Actor?.ID;
        const identity = known.get(id);
        if (typeof id === "string" && identity) follow(id, identity);
      }
    }
  });
  events.on("error", (error) =>
    status({ ev: "events-error", code: error.code ?? null }),
  );
  events.on("exit", (code, signal) =>
    status({ ev: "events-exit", code, signal }),
  );
  status({ ev: "recording" });

  const finish = () => {
    events.kill("SIGTERM");
    for (const child of followed.values()) child.kill("SIGTERM");
    status({
      ev: "stopped",
      dockerEvents: counts.events,
      followedContainers: followed.size,
      traceLines: Object.fromEntries(
        [...followed.keys()].map((id) => [
          id.slice(0, 12),
          counts.traceLines.get(id) ?? 0,
        ]),
      ),
      logLines: Object.fromEntries(
        [...followed.keys()].map((id) => [
          id.slice(0, 12),
          counts.logLines.get(id) ?? 0,
        ]),
      ),
    });
    process.exit(0);
  };
  process.on("SIGTERM", finish);
  process.on("SIGINT", finish);
}

async function stop(dir, out) {
  const pidFile = path.join(dir, "recorder.pid");
  let pid = null;
  try {
    pid = Number(fs.readFileSync(pidFile, "utf8"));
  } catch {
    // Never started; whatever exists is still copied.
  }
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  fs.mkdirSync(out, { recursive: true });
  const copied = [];
  for (const name of [
    "docker-events.ndjson",
    "container-requests.ndjson",
    "recorder.ndjson",
  ]) {
    const from = path.join(dir, name);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(out, name));
      copied.push(name);
    }
  }
  console.log(
    `container diagnostics: ${copied.length ? copied.join(", ") : "nothing recorded"} -> ${out}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "record" && args[0]) record(args[0]);
    else if (command === "stop" && args[0] && args[1])
      await stop(args[0], args[1]);
    else {
      console.error(
        "usage: container-diagnostics.mjs record <dir> | stop <dir> <out>",
      );
    }
  } catch (error) {
    // Diagnostics only: say what failed, never fail the job.
    console.error(`container diagnostics: ${error?.message ?? error}`);
  }
}
