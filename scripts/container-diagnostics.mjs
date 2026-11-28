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
 * The preview container's request record is a file the Worker reads back
 * only when a start completes, which never reaches traffic after a
 * container's last start. The recorder also copies that one file out of
 * each running preview container every SNAPSHOT_INTERVAL_MS with
 * `docker cp` (Docker's archive API: no command runs in the container and
 * its network is not touched), one copy at a time, bounded in size and
 * time, until the container stops; the latest copy is kept, reduced the
 * same way, as snapshot-requests-<container>.ndjson. Lines written after
 * the last copy that succeeded are still not seen.
 *
 * Each Docker event keeps a fixed set of fields, and from a container's log
 * the lines carrying the request record's marker are reduced to that
 * record's own fields. No label, environment, command line, header, cookie,
 * query or body is taken from Docker's own data.
 *
 * Why a container stopped (handoff 2026-11-23, a preview container's main
 * process exiting with 1 mid-start) needs its own output and exit status,
 * so for every container it follows the recorder also keeps:
 *
 * - container-output-<container>.ndjson: a summary line, then the last
 *   OUTPUT_MAX_LINES lines of its stdout and stderr (at most
 *   OUTPUT_MAX_BYTES in all, each line cut at OUTPUT_MAX_LINE_BYTES), with
 *   Docker's timestamp and the stream. The summary says how many lines and
 *   bytes were dropped from the front and how many lines were cut. Every
 *   line passes through redactSecrets first: a container's output is not
 *   Morph's to vouch for (the deploy step hands a container a Cloudflare
 *   token in its environment), so token-, key- and password-shaped values,
 *   URL queries and credentials in URLs are replaced before anything is
 *   kept. These lines go to the artifact only, never to the job log.
 * - container-exit.ndjson: the container's State from `docker inspect`
 *   (status, exit code, OOMKilled, error, start and finish times) each time
 *   it dies, and once more for every followed container when the recorder
 *   stops. Only `{{json .State}}` is asked for, so no configuration or
 *   environment is ever read. A container restarted right after its death
 *   can be inspected already running again; such an entry says `running`,
 *   and the die event's own exitCode is kept beside it.
 *
 * Every step that cannot be done is recorded as such; none of them fails
 * the job.
 *
 * A request missing from the container record is not, by itself, a request
 * that never arrived: first rule out the record missing it. recorder.ndjson
 * says which containers were followed, how many log lines each gave in all
 * and how many were records, and how reading each log ended; each Vite
 * process writes `trace-start` when its record begins, and the Worker's own
 * start line carries `vite.requestTrace` when it handed Vite the switch.
 */
import { spawn, spawnSync } from "node:child_process";
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
  n: "number",
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

/**
 * The request record's file in the preview container
 * (theme-preview-request-trace.ts).
 */
export const RECORD_PATH = "/tmp/morph-preview-request-trace.txt";
export const SNAPSHOT_INTERVAL_MS = 2_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const INSPECT_TIMEOUT_MS = 5_000;
// The record stops at 4 MiB; a copy is that file in a tar archive.
const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024 + 64 * 1024;

/**
 * The one regular file in the archive `docker cp <container>:<file> -`
 * writes, or null when the archive is not that.
 */
export function readSingleFileTar(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512) return null;
  const header = buffer.subarray(0, 512);
  if (header[156] !== 0x30 && header[156] !== 0) return null;
  const field = header.subarray(124, 136).toString("ascii");
  const size = Number.parseInt(field.split("\0", 1)[0].trim(), 8);
  if (!Number.isFinite(size) || size < 0 || 512 + size > buffer.length) {
    return null;
  }
  return buffer.subarray(512, 512 + size);
}

/** A copy of the record file, reduced line by line like a log line. */
export function snapshotRecords(text, id, identity) {
  const records = [];
  let invalid = 0;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const trace = parseTraceLine(line);
    if (!trace) {
      invalid++;
      continue;
    }
    records.push({
      ...trace,
      source: "snapshot",
      container: id.slice(0, 12),
      role: identity.role,
      objectId: identity.objectId,
    });
  }
  return { records, invalid };
}

export const OUTPUT_MAX_LINES = 2_000;
export const OUTPUT_MAX_BYTES = 1024 * 1024;
export const OUTPUT_MAX_LINE_BYTES = 8 * 1024;
export const REDACTED = "[REDACTED]";

// A name that says its value is a secret, as `name=value`, `name: value` or
// `"name":"value"`. Matched within a longer name too (MORPH_API_TOKEN).
const SECRET_NAME =
  "[A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth(?:orization)?|cookie|credential|signature)[A-Za-z0-9_.-]*";
// Each pattern has two groups: what is kept before the value, and the value.
const SECRET_PATTERNS = [
  // `Authorization: Bearer x`, `Basic x`, and a bare `Bearer x`. First, so
  // the named-value pattern below does not take the scheme for the value.
  /(\b(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]+)/gi,
  // A named value, quoted or not.
  new RegExp(
    `((?:^|[^A-Za-z0-9_])"?${SECRET_NAME}"?\\s*[:=]\\s*)("(?:[^"\\\\]|\\\\.)*"|'[^']*'|\\[REDACTED\\]|[^\\s,;&"'}\\]]+)`,
    "gi",
  ),
  // Credentials in a URL: scheme://user:password@host.
  /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+:[^\s/@]+)(?=@)/gi,
  // A URL query's values: preview and access links carry tokens there.
  /([?&][^=\s&#"']+=)([^&\s#"']+)/g,
  // JSON Web Tokens.
  /()(\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*)/g,
  // Well-known token prefixes: GitHub, Slack, OpenAI/Anthropic-style, AWS.
  /()(\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b)/g,
];
// A long run of token characters mixing upper case, lower case and digits
// (a Cloudflare API token is 40 of them). Plain hex (container ids,
// digests) and paths are left alone.
const OPAQUE_RUN = /[A-Za-z0-9_+=-]{32,}/g;

function looksOpaque(run) {
  if (/^[0-9a-fA-F_-]+$/.test(run)) return false;
  return /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run);
}

/**
 * A line of container output with secret-shaped values replaced by
 * REDACTED, and how many were replaced. Errs towards replacing: a lost
 * detail costs a diagnosis, a kept token costs a credential.
 */
export function redactSecrets(text) {
  let count = 0;
  let out = String(text);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix, value) => {
      if (value.includes(REDACTED)) return match;
      count++;
      // A quoted value stays quoted, so a JSON line stays JSON.
      const quote = /^["']/.test(value) ? value[0] : "";
      return `${prefix}${quote}${REDACTED}${quote}`;
    });
  }
  out = out.replace(OPAQUE_RUN, (run) => {
    if (!looksOpaque(run)) return run;
    count++;
    return REDACTED;
  });
  return { text: out, count };
}

/**
 * `docker logs --timestamps` puts an RFC 3339 time and a space before each
 * line; the line itself is the rest.
 */
export function splitDockerTimestamp(line) {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})) (.*)$/s.exec(
      line,
    );
  return match ? { t: match[1], text: match[2] } : { t: null, text: line };
}

/**
 * The last lines of one container's output, bounded by line count and by
 * bytes; what falls off the front is counted, and a line too long is cut.
 * `push` takes a line as written (redaction is the caller's).
 */
export function createOutputTail({
  maxLines = OUTPUT_MAX_LINES,
  maxBytes = OUTPUT_MAX_BYTES,
  maxLineBytes = OUTPUT_MAX_LINE_BYTES,
} = {}) {
  const lines = [];
  let bytes = 0;
  let total = 0;
  let droppedLines = 0;
  let droppedBytes = 0;
  let cutLines = 0;
  return {
    push(entry) {
      total++;
      let text = entry.text;
      const size = Buffer.byteLength(text, "utf8");
      if (size > maxLineBytes) {
        // Cut on a character boundary, and say how much was cut.
        const kept = Buffer.from(text, "utf8")
          .subarray(0, maxLineBytes)
          .toString("utf8")
          .replace(/�+$/, "");
        text = `${kept}…[cut ${size - Buffer.byteLength(kept, "utf8")} bytes]`;
        cutLines++;
      }
      const kept = { ...entry, text };
      const keptBytes = Buffer.byteLength(text, "utf8");
      lines.push({ value: kept, bytes: keptBytes });
      bytes += keptBytes;
      while (
        lines.length > maxLines ||
        (bytes > maxBytes && lines.length > 1)
      ) {
        const dropped = lines.shift();
        bytes -= dropped.bytes;
        droppedLines++;
        droppedBytes += dropped.bytes;
      }
    },
    summary() {
      return {
        totalLines: total,
        keptLines: lines.length,
        keptBytes: bytes,
        droppedLines,
        droppedBytes,
        cutLines,
        truncated: droppedLines > 0 || cutLines > 0,
        limits: { maxLines, maxBytes, maxLineBytes },
      };
    },
    lines() {
      return lines.map((line) => line.value);
    },
  };
}

/**
 * A container's `{{json .State}}`, reduced to what says how and when it
 * stopped. Null when the text is not that.
 */
export function parseContainerState(text) {
  let raw;
  try {
    raw = JSON.parse(String(text).trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const string = (value) => (typeof value === "string" ? value : null);
  const bool = (value) => (typeof value === "boolean" ? value : null);
  if (typeof raw.ExitCode !== "number" && typeof raw.Status !== "string") {
    return null;
  }
  const error = string(raw.Error);
  return {
    status: string(raw.Status),
    running: bool(raw.Running),
    restarting: bool(raw.Restarting),
    dead: bool(raw.Dead),
    oomKilled: bool(raw.OOMKilled),
    exitCode: typeof raw.ExitCode === "number" ? raw.ExitCode : null,
    error: error ? redactSecrets(error).text : error,
    startedAt: string(raw.StartedAt),
    finishedAt: string(raw.FinishedAt),
  };
}

/**
 * The lines `docker inspect --format '{{.Id}} {{json .State}}' <id>...`
 * prints, one per container found, as id -> state.
 */
export function parseInspectLines(text) {
  const states = new Map();
  for (const line of String(text).split("\n")) {
    const at = line.indexOf(" ");
    if (at === -1) continue;
    const id = line.slice(0, at);
    if (!/^[0-9a-f]{12,64}$/.test(id)) continue;
    const state = parseContainerState(line.slice(at + 1));
    if (state) states.set(id, state);
  }
  return states;
}

/** A die event's own exit code (Docker gives it as a string), or null. */
export function exitCodeOf(event) {
  const code = event?.exitCode;
  return typeof code === "string" && /^-?\d+$/.test(code) ? Number(code) : null;
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
  const snapshots = new Map();

  const snapshotOnce = (id, identity, state) => {
    if (state.inFlight) return;
    state.inFlight = true;
    state.taken++;
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let stderr = "";
    const child = spawn("docker", ["cp", `${id}:${RECORD_PATH}`, "-"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), SNAPSHOT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > SNAPSHOT_MAX_BYTES) {
        tooLarge = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 400);
    });
    let settled = false;
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.inFlight = false;
      if (outcome !== "ok") state.errors++;
      // Said once per change of outcome, not once per copy.
      if (outcome !== state.lastOutcome) {
        state.lastOutcome = outcome;
        if (outcome !== "ok") {
          status({ ev: "snapshot-error", container: id.slice(0, 12), outcome });
        }
      }
    };
    child.on("error", (error) => done(`spawn-${error.code ?? "error"}`));
    child.on("close", (code, signal) => {
      if (tooLarge) return done("too-large");
      if (signal) return done(`killed-${signal}`);
      if (code !== 0) {
        return done(
          /could not find|no such file/i.test(stderr)
            ? "missing"
            : `exit-${code}`,
        );
      }
      const file = readSingleFileTar(Buffer.concat(chunks));
      if (!file) return done("unreadable");
      done("ok");
      state.lastOkAt = new Date().toISOString();
      if (file.length === state.lastBytes) return;
      state.lastBytes = file.length;
      state.changed++;
      const { records, invalid } = snapshotRecords(
        file.toString("utf8"),
        id,
        identity,
      );
      const target = path.join(
        dir,
        `snapshot-requests-${id.slice(0, 12)}.ndjson`,
      );
      fs.writeFileSync(
        `${target}.tmp`,
        records.map((value) => `${JSON.stringify(value)}\n`).join(""),
      );
      fs.renameSync(`${target}.tmp`, target);
      state.lastAt = new Date().toISOString();
      state.lastRecords = records.length;
      status({
        ev: "snapshot",
        container: id.slice(0, 12),
        bytes: file.length,
        records: records.length,
        invalid,
      });
    });
  };

  const startSnapshots = (id, identity) => {
    if (identity.role !== "preview" || snapshots.has(id)) return;
    const state = {
      inFlight: false,
      taken: 0,
      changed: 0,
      errors: 0,
      lastBytes: -1,
      lastAt: null,
      lastOkAt: null,
      lastRecords: 0,
      lastOutcome: null,
      timer: null,
    };
    state.timer = setInterval(
      () => snapshotOnce(id, identity, state),
      SNAPSHOT_INTERVAL_MS,
    );
    snapshots.set(id, state);
  };

  const stopSnapshots = (id) => {
    const state = snapshots.get(id);
    if (state?.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  };
  const counts = { events: 0, traceLines: new Map(), logLines: new Map() };

  // Per followed container: the tail of its output and what was read.
  const outputs = new Map();
  const exitFile = path.join(dir, "container-exit.ndjson");

  const writeOutput = (id) => {
    const output = outputs.get(id);
    if (!output) return;
    const target = path.join(dir, `container-output-${id.slice(0, 12)}.ndjson`);
    const summary = {
      kind: "summary",
      container: id.slice(0, 12),
      role: output.identity.role,
      objectId: output.identity.objectId,
      // More than one when the container was started again: Docker keeps
      // one log across restarts, read again from its start.
      follows: output.follows,
      // Request-record lines are in container-requests.ndjson, reduced;
      // they are not repeated here.
      traceLinesOmitted: output.traceLines,
      redactions: output.redactions,
      ...output.tail.summary(),
    };
    try {
      fs.writeFileSync(
        `${target}.tmp`,
        [summary, ...output.tail.lines()]
          .map((value) => `${JSON.stringify(value)}\n`)
          .join(""),
      );
      fs.renameSync(`${target}.tmp`, target);
    } catch (error) {
      status({
        ev: "output-write-error",
        container: id.slice(0, 12),
        code: error?.code ?? null,
      });
    }
  };

  const follow = (id, identity) => {
    if (
      !identity.role ||
      identity.role === "other" ||
      identity.role.endsWith("-proxy")
    ) {
      return;
    }
    const running = followed.get(id);
    if (running && running.exitCode === null && running.signalCode === null) {
      return;
    }
    let output = outputs.get(id);
    if (!output) {
      output = {
        identity,
        tail: createOutputTail(),
        redactions: 0,
        traceLines: 0,
        follows: 0,
        seen: { stdout: 0, stderr: 0 },
      };
      outputs.set(id, output);
    }
    output.follows++;
    // A restart's log starts again from the container's first line: skip,
    // per stream, the lines already read.
    const skip = { ...output.seen };
    const child = spawn("docker", ["logs", "--follow", "--timestamps", id], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    followed.set(id, child);
    const pending = { stdout: "", stderr: "" };
    const handle = (stream, line) => {
      if (skip[stream] > 0) {
        skip[stream]--;
        return;
      }
      output.seen[stream]++;
      counts.logLines.set(id, (counts.logLines.get(id) ?? 0) + 1);
      const { t, text } = splitDockerTimestamp(line);
      const trace = parseTraceLine(text);
      if (trace) {
        output.traceLines++;
        counts.traceLines.set(id, (counts.traceLines.get(id) ?? 0) + 1);
        appendLine(requestsFile, {
          ...trace,
          source: "container",
          container: id.slice(0, 12),
          role: identity.role,
          objectId: identity.objectId,
        });
        return;
      }
      // Redacted before it is held, so nothing unredacted is ever written.
      const redacted = redactSecrets(text);
      output.redactions += redacted.count;
      output.tail.push({ t, stream, text: redacted.text });
    };
    const read = (stream) => (chunk) => {
      pending[stream] += chunk.toString("utf8");
      const lines = pending[stream].split("\n");
      pending[stream] = lines.pop() ?? "";
      for (const line of lines) handle(stream, line);
    };
    child.stdout.on("data", read("stdout"));
    child.stderr.on("data", read("stderr"));
    output.flush = () => {
      for (const stream of ["stdout", "stderr"]) {
        if (pending[stream] !== "") handle(stream, pending[stream]);
        pending[stream] = "";
      }
    };
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
    // Every byte read: write what this container said so far.
    child.on("close", () => {
      output.flush();
      writeOutput(id);
    });
  };

  const exitEntry = (id, trigger, extra) => {
    const identity = outputs.get(id)?.identity ?? known.get(id);
    return {
      t: new Date().toISOString(),
      trigger,
      container: id.slice(0, 12),
      role: identity?.role ?? "other",
      objectId: identity?.objectId ?? null,
      ...extra,
    };
  };

  // The container's State as soon as it dies. Asks for `.State` only.
  const inspectOnDie = (id, eventExitCode) => {
    if (!outputs.has(id)) return;
    let stdout = "";
    let stderr = "";
    const child = spawn(
      "docker",
      ["inspect", "--type", "container", "--format", "{{json .State}}", id],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), INSPECT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(0, 64 * 1024);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 400);
    });
    let settled = false;
    const done = (outcome, state = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      appendLine(
        exitFile,
        exitEntry(id, "die", { eventExitCode, outcome, state }),
      );
    };
    child.on("error", (error) => done(`spawn-${error.code ?? "error"}`));
    child.on("close", (code, signal) => {
      if (signal) return done(`killed-${signal}`);
      if (code !== 0) {
        return done(/no such/i.test(stderr) ? "missing" : `exit-${code}`);
      }
      const state = parseContainerState(stdout);
      return state ? done("ok", state) : done("unreadable");
    });
  };

  // Once more for every followed container when the recorder stops, in one
  // bounded call: the containers still running, and the last word on the
  // ones that died.
  const inspectAllOnStop = () => {
    const ids = [...outputs.keys()];
    if (ids.length === 0) return;
    const result = spawnSync(
      "docker",
      [
        "inspect",
        "--type",
        "container",
        "--format",
        "{{.Id}} {{json .State}}",
        ...ids,
      ],
      {
        encoding: "utf8",
        timeout: INSPECT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const states = parseInspectLines(result.stdout ?? "");
    const failed = result.error
      ? `spawn-${result.error.code ?? "error"}`
      : null;
    for (const id of ids) {
      const state = states.get(id) ?? null;
      appendLine(
        exitFile,
        exitEntry(id, "stopped", {
          outcome: state ? "ok" : (failed ?? "missing"),
          state,
        }),
      );
    }
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
        if (typeof id === "string" && identity) {
          follow(id, identity);
          startSnapshots(id, identity);
        }
      }
      if (event.type === "container" && event.action === "kill") {
        // One last copy while the container is still there; it may lose
        // the race with its removal.
        const id = raw.Actor?.ID;
        const state = snapshots.get(id);
        if (state?.timer) snapshotOnce(id, known.get(id), state);
      }
      if (
        event.type === "container" &&
        (event.action === "die" || event.action === "destroy")
      ) {
        stopSnapshots(raw.Actor?.ID);
      }
      if (event.type === "container" && event.action === "die") {
        const id = raw.Actor?.ID;
        if (typeof id === "string") {
          inspectOnDie(id, exitCodeOf(event));
        }
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
    for (const id of snapshots.keys()) stopSnapshots(id);
    events.kill("SIGTERM");
    for (const child of followed.values()) child.kill("SIGTERM");
    inspectAllOnStop();
    for (const [id, output] of outputs) {
      output.flush?.();
      writeOutput(id);
    }
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
      snapshots: Object.fromEntries(
        [...snapshots.entries()].map(([id, state]) => [
          id.slice(0, 12),
          {
            taken: state.taken,
            changed: state.changed,
            errors: state.errors,
            lastBytes: state.lastBytes,
            lastRecords: state.lastRecords,
            lastChangeAt: state.lastAt,
            // The end of what the copies cover.
            lastOkAt: state.lastOkAt,
          },
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
    // The recorder inspects every followed container once more and writes
    // their output before it exits, each bounded (INSPECT_TIMEOUT_MS).
    for (let i = 0; i < 150; i++) {
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
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // Nothing recorded.
  }
  for (const name of keptFileNames(names)) {
    const from = path.join(dir, name);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(out, name));
      copied.push(name);
    }
  }
  // File names only: what the containers said stays in the artifact.
  const outputs = copied.filter((name) => name.startsWith("container-output-"));
  const listed = copied.filter((name) => !name.startsWith("container-output-"));
  if (outputs.length)
    listed.push(`container-output-*.ndjson (${outputs.length})`);
  console.log(
    `container diagnostics: ${listed.length ? listed.join(", ") : "nothing recorded"} -> ${out}`,
  );
}

/** Which of the recorder's files are kept with the results, in order. */
export function keptFileNames(names) {
  const fixed = [
    "docker-events.ndjson",
    "container-requests.ndjson",
    "container-exit.ndjson",
    "recorder.ndjson",
  ];
  const per = (pattern) => names.filter((name) => pattern.test(name)).sort();
  return [
    ...fixed.filter((name) => names.includes(name)),
    ...per(/^snapshot-requests-[0-9a-f]{12}\.ndjson$/),
    ...per(/^container-output-[0-9a-f]{12}\.ndjson$/),
  ];
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
