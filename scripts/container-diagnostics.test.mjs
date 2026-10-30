import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containerRole,
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
