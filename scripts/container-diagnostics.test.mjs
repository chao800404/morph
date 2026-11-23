import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  containerRole,
  createOutputTail,
  exitCodeOf,
  keptFileNames,
  OUTPUT_MAX_BYTES,
  OUTPUT_MAX_LINE_BYTES,
  OUTPUT_MAX_LINES,
  parseContainerState,
  parseInspectLines,
  redactSecrets,
  splitDockerTimestamp,
  parseTraceLine,
  readSingleFileTar,
  RECORD_PATH,
  snapshotRecords,
  sanitizeDockerEvent,
} from "./container-diagnostics.mjs";

const OBJECT =
  "04e7edab6bb89f238b5049431c3658b69b0a9abba543f39dad98ff75638d12d1";

test("names each container's role from the local runtime's container name", () => {
  assert.deepEqual(containerRole(`workerd-morph-PreviewSandbox-${OBJECT}`), {
    role: "preview",
    objectId: "04e7edab6bb8",
  });
  assert.deepEqual(
    containerRole(`/workerd-morph-BuildPreviewSandbox-${OBJECT}`),
    { role: "build-preview", objectId: "04e7edab6bb8" },
  );
  assert.deepEqual(containerRole(`workerd-morph-Sandbox-${OBJECT}`), {
    role: "theme-build",
    objectId: "04e7edab6bb8",
  });
  assert.deepEqual(
    containerRole(`workerd-morph-PreviewSandbox-${OBJECT}-proxy`),
    {
      role: "preview-proxy",
      objectId: "04e7edab6bb8",
    },
  );
  assert.deepEqual(containerRole("unrelated"), {
    role: "other",
    objectId: null,
  });
  assert.deepEqual(containerRole(undefined), { role: "other", objectId: null });
});

test("keeps a fixed set of a Docker event's fields, and no label or command", () => {
  const known = new Map();
  const id = "e6a2dffc8216" + "0".repeat(52);
  const start = sanitizeDockerEvent(
    {
      Type: "container",
      Action: "start",
      Actor: {
        ID: id,
        Attributes: {
          name: `workerd-morph-PreviewSandbox-${OBJECT}`,
          image: "cloudflare-dev/previewsandbox:1f82a639",
          "com.example.secret": "label-value",
          SECRET_TOKEN: "abc",
        },
      },
      time: 1793357185,
      timeNano: 1793357185123456789,
    },
    known,
  );
  assert.deepEqual(start, {
    t: "2026-10-30T10:46:25.123Z",
    source: "docker",
    type: "container",
    action: "start",
    container: "e6a2dffc8216",
    role: "preview",
    objectId: "04e7edab6bb8",
    name: `workerd-morph-PreviewSandbox-${OBJECT}`,
    image: "cloudflare-dev/previewsandbox:1f82a639",
  });

  const exec = sanitizeDockerEvent(
    {
      Type: "container",
      Action: "exec_start: sh -c 'echo $SECRET'",
      Actor: { ID: id, Attributes: { execID: "x" } },
      timeNano: 1793357186000000000,
    },
    known,
  );
  assert.equal(exec.action, "exec_start");
  assert.equal(exec.role, "preview");
  assert.ok(!JSON.stringify(exec).includes("SECRET"));

  const network = sanitizeDockerEvent(
    {
      Type: "network",
      Action: "disconnect",
      Actor: {
        ID: "net1",
        Attributes: { container: id, name: "bridge", type: "bridge" },
      },
      timeNano: 1793357187000000000,
    },
    known,
  );
  assert.deepEqual(network, {
    t: "2026-10-30T10:46:27.000Z",
    source: "docker",
    type: "network",
    action: "disconnect",
    container: "e6a2dffc8216",
    role: "preview",
    objectId: "04e7edab6bb8",
    network: "bridge",
  });

  assert.equal(sanitizeDockerEvent({ Type: "image", Action: "pull" }), null);
  assert.equal(sanitizeDockerEvent(null), null);
});

test("reads only request-record lines from a container's log, reduced to their own fields", () => {
  assert.equal(
    parseTraceLine(
      '{"level":"info","message":"sandbox.exec success cat /secret"}',
    ),
    null,
  );
  assert.equal(parseTraceLine("MORPH_PREVIEW_REQUEST_TRACE not json"), null);
  const parsed = parseTraceLine(
    'MORPH_PREVIEW_REQUEST_TRACE {"t":"2026-10-30T10:46:26.475Z","ev":"res","seq":7,"outcome":"closed-before-finish","status":200,"ms":12,"handedBytes":65536,"deliveredBytes":"unknown","cookie":"session=1","path":"/src/a.ts?previewSession=x"}',
  );
  assert.deepEqual(parsed, {
    t: "2026-10-30T10:46:26.475Z",
    ev: "res",
    seq: 7,
    outcome: "closed-before-finish",
    status: 200,
    ms: 12,
    handedBytes: 65536,
    deliveredBytes: "unknown",
    path: "/src/a.ts",
  });
  // A delivered count is never taken from a container line: only "unknown".
  assert.equal(
    parseTraceLine(
      'MORPH_PREVIEW_REQUEST_TRACE {"t":"x","ev":"res","deliveredBytes":"139374"}',
    ).deliveredBytes,
    undefined,
  );
});

function tarOf(name, content, type = "0") {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, "ascii");
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write(type, 156, "ascii");
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

test("reads the one file out of the archive docker cp writes", () => {
  const content = "MORPH_PREVIEW_REQUEST_TRACE {}\n".repeat(40);
  assert.equal(
    readSingleFileTar(
      tarOf("morph-preview-request-trace.txt", content),
    )?.toString("utf8"),
    content,
  );
  assert.equal(readSingleFileTar(tarOf("x", "")).length, 0);
  // A directory, a cut-off archive, or nothing at all is not the file.
  assert.equal(readSingleFileTar(tarOf("d/", "", "5")), null);
  assert.equal(readSingleFileTar(tarOf("x", "abcdef").subarray(0, 514)), null);
  assert.equal(readSingleFileTar(Buffer.alloc(10)), null);
  assert.equal(readSingleFileTar("not a buffer"), null);
  assert.equal(RECORD_PATH, "/tmp/morph-preview-request-trace.txt");
});

test("reduces a copied record like a log line, keeping the line number and naming the Docker container", () => {
  const text = [
    'MORPH_PREVIEW_REQUEST_TRACE {"t":"2026-10-31T01:00:00.000Z","pid":5528,"n":7,"ev":"req","seq":3,"conn":2,"method":"GET","path":"/src/a.ts?previewSession=x","cookie":"sid=1"}',
    'MORPH_PREVIEW_REQUEST_TRACE {"t":"2026-10-31T01:00:00.010Z","pid":5528,"n":8,"ev":"res","seq":3,"outcome":"finished","status":200,"ms":10,"handedBytes":5,"deliveredBytes":"5"}',
    "MORPH_PREVIEW_REQUEST_TRACE {not json",
    'MORPH_PREVIEW_REQUEST_TRACE {"t":"2026-10-31T01:00:00.0',
    "",
  ].join("\n");
  const { records, invalid } = snapshotRecords(
    text,
    "3aa675dc5886ffffffffffff",
    { role: "preview", objectId: "0743a9a8173e" },
  );
  // A line cut off mid-write is counted as invalid, not kept.
  assert.equal(invalid, 2);
  const docker = {
    source: "snapshot",
    container: "3aa675dc5886",
    role: "preview",
    objectId: "0743a9a8173e",
  };
  assert.deepEqual(records, [
    {
      t: "2026-10-31T01:00:00.000Z",
      pid: 5528,
      n: 7,
      ev: "req",
      seq: 3,
      conn: 2,
      method: "GET",
      path: "/src/a.ts",
      ...docker,
    },
    {
      t: "2026-10-31T01:00:00.010Z",
      pid: 5528,
      n: 8,
      ev: "res",
      seq: 3,
      outcome: "finished",
      status: 200,
      ms: 10,
      handedBytes: 5,
      ...docker,
    },
  ]);
});

test("keeps the last lines of a container's output within its line and byte bounds, and says what was dropped or cut", () => {
  const tail = createOutputTail({
    maxLines: 3,
    maxBytes: 1000,
    maxLineBytes: 100,
  });
  for (let i = 1; i <= 5; i++) {
    tail.push({ t: null, stream: "stdout", text: `line ${i}` });
  }
  assert.deepEqual(
    tail.lines().map((line) => line.text),
    ["line 3", "line 4", "line 5"],
  );
  assert.deepEqual(tail.summary(), {
    totalLines: 5,
    keptLines: 3,
    keptBytes: 18,
    droppedLines: 2,
    droppedBytes: 12,
    cutLines: 0,
    truncated: true,
    limits: { maxLines: 3, maxBytes: 1000, maxLineBytes: 100 },
  });

  // Bytes bound the tail too, whatever the line count allows.
  const bytes = createOutputTail({
    maxLines: 100,
    maxBytes: 25,
    maxLineBytes: 100,
  });
  for (const text of ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]) {
    bytes.push({ t: null, stream: "stderr", text });
  }
  assert.deepEqual(
    bytes.lines().map((line) => line.text),
    ["bbbbbbbbbb", "cccccccccc"],
  );
  assert.equal(bytes.summary().droppedBytes, 10);
  assert.equal(bytes.summary().truncated, true);

  // A line too long is cut on a character boundary, and the cut is said.
  const long = createOutputTail({
    maxLines: 10,
    maxBytes: 1000,
    maxLineBytes: 10,
  });
  long.push({
    t: "2026-11-23T00:00:00Z",
    stream: "stdout",
    text: "123456789é0123",
  });
  const [cut] = long.lines();
  assert.equal(cut.text, "123456789…[cut 6 bytes]");
  assert.equal(cut.t, "2026-11-23T00:00:00Z");
  assert.equal(cut.stream, "stdout");
  assert.equal(long.summary().cutLines, 1);
  assert.equal(long.summary().truncated, true);

  // Nothing over the bounds: nothing is said to be truncated.
  const whole = createOutputTail();
  whole.push({ t: null, stream: "stdout", text: "ready" });
  assert.equal(whole.summary().truncated, false);
  assert.deepEqual(whole.summary().limits, {
    maxLines: OUTPUT_MAX_LINES,
    maxBytes: OUTPUT_MAX_BYTES,
    maxLineBytes: OUTPUT_MAX_LINE_BYTES,
  });
  assert.equal(OUTPUT_MAX_LINES, 2000);
  assert.equal(OUTPUT_MAX_BYTES, 1024 * 1024);
});

test("splits Docker's timestamp from a log line", () => {
  assert.deepEqual(
    splitDockerTimestamp("2026-11-23T15:41:16.552931873Z Error: exit 1"),
    { t: "2026-11-23T15:41:16.552931873Z", text: "Error: exit 1" },
  );
  assert.deepEqual(splitDockerTimestamp("no time here"), {
    t: null,
    text: "no time here",
  });
});

test("reads a container's exit status from docker inspect's State and nothing else", () => {
  const state = {
    Status: "exited",
    Running: false,
    Paused: false,
    Restarting: false,
    OOMKilled: false,
    Dead: false,
    Pid: 0,
    ExitCode: 1,
    Error: "",
    StartedAt: "2026-11-23T15:39:06.127Z",
    FinishedAt: "2026-11-23T15:41:16.634Z",
    Health: { Log: [{ Output: "TOKEN=abc" }] },
  };
  assert.deepEqual(parseContainerState(JSON.stringify(state)), {
    status: "exited",
    running: false,
    restarting: false,
    dead: false,
    oomKilled: false,
    exitCode: 1,
    error: "",
    startedAt: "2026-11-23T15:39:06.127Z",
    finishedAt: "2026-11-23T15:41:16.634Z",
  });
  assert.equal(
    parseContainerState(
      JSON.stringify({ ...state, OOMKilled: true, ExitCode: 137 }),
    )?.oomKilled,
    true,
  );
  // An error from Docker is redacted like output.
  assert.equal(
    parseContainerState(
      JSON.stringify({ ...state, Error: "failed: api_token=abcdef123" }),
    )?.error,
    "failed: api_token=[REDACTED]",
  );
  for (const text of ["", "not json", "null", "[]", '{"Name":"x"}']) {
    assert.equal(parseContainerState(text), null, text);
  }

  const id = "17ed2a3ec29b".padEnd(64, "0");
  const states = parseInspectLines(
    `${id} ${JSON.stringify(state)}\nError: No such container: deadbeef\n${"a".repeat(64)} not json\n`,
  );
  assert.deepEqual([...states.keys()], [id]);
  assert.equal(states.get(id)?.exitCode, 1);

  assert.equal(exitCodeOf({ exitCode: "1" }), 1);
  assert.equal(exitCodeOf({ exitCode: "137" }), 137);
  assert.equal(exitCodeOf({}), null);
  assert.equal(exitCodeOf({ exitCode: "x" }), null);
});

test("redacts secret-shaped values from container output before it is kept", () => {
  const cases = [
    ["CLOUDFLARE_API_TOKEN=abc123", "CLOUDFLARE_API_TOKEN=[REDACTED]"],
    ['{"apiKey":"k-1","msg":"ok"}', '{"apiKey":"[REDACTED]","msg":"ok"}'],
    ["password: hunter2 next", "password: [REDACTED] next"],
    [
      "Authorization: Bearer abc.def-ghi",
      "Authorization: [REDACTED] [REDACTED]",
    ],
    [
      "cookie=better-auth.session_token=xyz; Path=/",
      "cookie=[REDACTED]; Path=/",
    ],
    [
      "GET https://x.test/p?previewToken=abc&n=1#h",
      "GET https://x.test/p?previewToken=[REDACTED]&n=[REDACTED]#h",
    ],
    ["redis://user:pa55@host:6379/0", "redis://[REDACTED]@host:6379/0"],
    [
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part-1 end",
      "jwt [REDACTED] end",
    ],
    ["gh ghp_abcdefghijklmnopqrstuvwxyz0123 x", "gh [REDACTED] x"],
    ["aws AKIAABCDEFGHIJKLMNOP", "aws [REDACTED]"],
    // A Cloudflare API token: 40 opaque characters, no name beside it.
    [
      "using Xk3mP9qL2vR7tY1wZ8bN4cF6hJ0sD5gA2eK7uQ now",
      "using [REDACTED] now",
    ],
  ];
  for (const [line, expected] of cases) {
    const { text, count } = redactSecrets(line);
    assert.equal(text, expected, line);
    assert.ok(count > 0, line);
  }
  // Ordinary diagnostic output is kept as it is: ids, digests, paths, errors.
  const keep = [
    "container 17ed2a3ec29b0000000000000000000000000000000000000000000000000000 exited",
    "sha256:6d741713aef266e8ae0831a5709c6f2d7b77b4952ac79b549f4f4e380af86fbe",
    "/opt/morph-toolchain/tanstack-start-1.168/node_modules/.bin/vite --port 5173",
    "OperationInterruptedError: Sandbox operation files.mkdir was interrupted",
    '{"level":"error","msg":"WritableStream RPC stub was disposed","sessionId":"s-1"}',
  ];
  for (const line of keep) {
    assert.deepEqual(redactSecrets(line), { text: line, count: 0 }, line);
  }
  // Already redacted text is not redacted again.
  assert.equal(redactSecrets("token=[REDACTED]").count, 0);
});

test("keeps the recorder's fixed files and its per-container ones, never a partial write", () => {
  assert.deepEqual(
    keptFileNames([
      "recorder.pid",
      "container-output-bbbbbbbbbbbb.ndjson",
      "container-output-aaaaaaaaaaaa.ndjson",
      "container-output-aaaaaaaaaaaa.ndjson.tmp",
      "recorder.ndjson",
      "container-exit.ndjson",
      "snapshot-requests-cccccccccccc.ndjson",
      ".dev.vars",
      "docker-events.ndjson",
    ]),
    [
      "docker-events.ndjson",
      "container-exit.ndjson",
      "recorder.ndjson",
      "snapshot-requests-cccccccccccc.ndjson",
      "container-output-aaaaaaaaaaaa.ndjson",
      "container-output-bbbbbbbbbbbb.ndjson",
    ],
  );
});

test("records a followed container's exit status and redacted output to files, not to its own log", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdiag-test-"));
  const bin = path.join(root, "bin");
  const dir = path.join(root, "record");
  const out = path.join(root, "out");
  fs.mkdirSync(bin);
  const id = "17ed2a3ec29b".padEnd(64, "1");
  const name = `workerd-morph-PreviewSandbox-${OBJECT}`;
  const state = {
    Status: "exited",
    Running: false,
    OOMKilled: false,
    Dead: false,
    ExitCode: 1,
    Error: "",
    StartedAt: "2026-11-23T15:39:06.127Z",
    FinishedAt: "2026-11-23T15:41:16.634Z",
  };
  // A stand-in for the Docker CLI: one preview container that starts,
  // prints on both streams, and dies with 1.
  const fake = [
    "#!/usr/bin/env node",
    "const [cmd, ...args] = process.argv.slice(2);",
    `const id = ${JSON.stringify(id)};`,
    `const name = ${JSON.stringify(name)};`,
    `const state = ${JSON.stringify(JSON.stringify(state))};`,
    "const ev = (Action, extra = {}) => JSON.stringify({ Type: 'container', Action, Actor: { ID: id, Attributes: { name, ...extra } }, timeNano: Date.now() * 1e6 });",
    "if (cmd === 'events') {",
    "  console.log(ev('start'));",
    "  setTimeout(() => console.log(ev('die', { exitCode: '1' })), 400);",
    "  setInterval(() => {}, 1000);",
    "} else if (cmd === 'logs') {",
    "  process.stdout.write('2026-11-23T15:41:16.000000001Z control: starting\\n');",
    "  process.stderr.write('2026-11-23T15:41:16.500000001Z fatal: CLOUDFLARE_API_TOKEN=supersecretvalue\\n');",
    '  process.stdout.write(\'2026-11-23T15:41:16.600000001Z MORPH_PREVIEW_REQUEST_TRACE {"ev":"trace-start","pid":1}\\n\');',
    "  process.stdout.write('2026-11-23T15:41:16.600000002Z no newline at the end');",
    "} else if (cmd === 'inspect') {",
    "  const format = args[args.indexOf('--format') + 1];",
    "  console.log(format.startsWith('{{.Id}}') ? id + ' ' + state : state);",
    "} else {",
    "  process.stderr.write('no such file');",
    "  process.exit(1);",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "docker"), fake, { mode: 0o755 });
  const script = fileURLToPath(
    new URL("./container-diagnostics.mjs", import.meta.url),
  );
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  const recorder = spawn(process.execPath, [script, "record", dir], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let printed = "";
  recorder.stdout.on("data", (chunk) => (printed += chunk));
  recorder.stderr.on("data", (chunk) => (printed += chunk));
  const closed = new Promise((resolve) => recorder.once("close", resolve));
  const outputFile = path.join(dir, "container-output-17ed2a3ec29b.ndjson");
  const exitFile = path.join(dir, "container-exit.ndjson");
  const deadline = Date.now() + 15_000;
  while (
    !(fs.existsSync(outputFile) && fs.existsSync(exitFile)) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Not spawnSync: this process must stay free to reap the recorder, or
  // `stop` sees its zombie alive and waits out its whole bound.
  const stopper = spawn(process.execPath, [script, "stop", dir, out], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = { stdout: "", stderr: "" };
  stopper.stdout.on("data", (chunk) => (stopped.stdout += chunk));
  stopper.stderr.on("data", (chunk) => (stopped.stderr += chunk));
  await Promise.all([
    closed,
    new Promise((resolve) => stopper.once("close", resolve)),
  ]);
  try {
    const [summary, ...lines] = fs
      .readFileSync(
        path.join(out, "container-output-17ed2a3ec29b.ndjson"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(summary.kind, "summary");
    assert.equal(summary.container, "17ed2a3ec29b");
    assert.equal(summary.role, "preview");
    assert.equal(summary.objectId, "04e7edab6bb8");
    assert.equal(summary.traceLinesOmitted, 1);
    assert.equal(summary.redactions, 1);
    assert.equal(summary.truncated, false);
    assert.deepEqual(lines.map(({ stream, text }) => [stream, text]).sort(), [
      ["stderr", "fatal: CLOUDFLARE_API_TOKEN=[REDACTED]"],
      ["stdout", "control: starting"],
      ["stdout", "no newline at the end"],
    ]);
    assert.equal(
      lines.find((line) => line.text === "control: starting")?.t,
      "2026-11-23T15:41:16.000000001Z",
    );

    const exits = fs
      .readFileSync(path.join(out, "container-exit.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const die = exits.find((entry) => entry.trigger === "die");
    assert.equal(die?.outcome, "ok");
    assert.equal(die?.eventExitCode, 1);
    assert.equal(die?.role, "preview");
    assert.equal(die?.state.exitCode, 1);
    assert.equal(die?.state.oomKilled, false);
    assert.equal(die?.state.startedAt, "2026-11-23T15:39:06.127Z");
    assert.equal(die?.state.finishedAt, "2026-11-23T15:41:16.634Z");
    const last = exits.find((entry) => entry.trigger === "stopped");
    assert.equal(last?.outcome, "ok");
    assert.equal(last?.state.exitCode, 1);

    // Nothing the container said reaches either process's own output.
    const logged = `${printed}${stopped.stdout}${stopped.stderr}`;
    assert.doesNotMatch(logged, /supersecretvalue|control: starting|fatal:/);
    assert.match(stopped.stdout, /container-output-\*\.ndjson \(1\)/);
    for (const file of fs.readdirSync(out)) {
      assert.doesNotMatch(
        fs.readFileSync(path.join(out, file), "utf8"),
        /supersecretvalue/,
        file,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
