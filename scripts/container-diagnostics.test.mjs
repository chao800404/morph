import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containerRole,
  parseTraceLine,
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
