// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBuildPreviewArtifact } from "./build-preview-artifact";
import { fixtureBuild } from "./build-preview-artifact.fixture";
import {
  BUILD_PREVIEW_EGRESS_DENIED,
  startLocalBuildPreviewWorker,
  type LocalBuildPreviewWorker,
} from "./local-build-preview-worker";

/**
 * The local Build Preview instance, run for real: the verified artifact of a
 * build, started in workerd on loopback.
 */
describe("a local Build Preview instance", () => {
  let worker: LocalBuildPreviewWorker;
  let content: Server;
  let contentOrigin = "";

  beforeAll(async () => {
    // Stands in for Core's /_morph/content, the one origin the preview may reach.
    content = createServer((_request, response) => {
      response.end("frozen-content");
    });
    await new Promise<void>((resolve) =>
      content.listen(0, "127.0.0.1", resolve),
    );
    contentOrigin = `http://127.0.0.1:${(content.address() as AddressInfo).port}`;

    const { build, r2Bucket } = fixtureBuild();
    const result = await readBuildPreviewArtifact({ build, r2Bucket });
    if (!result.ok) throw new Error(result.message);
    worker = await startLocalBuildPreviewWorker(result.artifact, {
      allowedOrigins: [contentOrigin],
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.dispose();
    await new Promise<void>((resolve) => content?.close(() => resolve()));
  });

  const get = (path: string) => fetch(`${worker.origin}${path}`);

  it("listens on loopback only", () => {
    expect(new URL(worker.origin).hostname).toBe("127.0.0.1");
  });

  it("runs the build's Worker at the root of its origin", async () => {
    const response = await get("/account");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("worker:/account");
  });

  it("serves the build's static assets", async () => {
    const response = await get("/app.css");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("body{color:red}");
  });

  it("gives the Worker an empty environment", async () => {
    // The author's `vars` were dropped with the plan, the deployment config
    // names no assets binding (assets are answered before the Worker runs),
    // and nothing of the starting process reaches the Worker.
    expect(await (await get("/env")).json()).toEqual([]);
  });

  it("refuses egress", async () => {
    const response = await get(
      `/egress?to=${encodeURIComponent("https://example.com/")}`,
    );
    expect(await response.text()).toBe(
      `403:${BUILD_PREVIEW_EGRESS_DENIED}: Build Preview does not allow requests to https://example.com.`,
    );
  });

  it("reaches the content origin it was given", async () => {
    const response = await get(
      `/egress?to=${encodeURIComponent(`${contentOrigin}/_morph/content`)}`,
    );
    expect(await response.text()).toBe("200:frozen-content");
  });
});

describe("a local Build Preview instance left idle", () => {
  it("stops itself and frees its port", async () => {
    const { build, r2Bucket } = fixtureBuild();
    const result = await readBuildPreviewArtifact({ build, r2Bucket });
    if (!result.ok) throw new Error(result.message);
    // No request first: under load a cold first request can outlast a short
    // idle window, and stopping is what this test is about. Serving is
    // covered above.
    const worker = await startLocalBuildPreviewWorker(result.artifact, {
      idleMs: 500,
    });
    await worker.stopped;
    await expect(fetch(`${worker.origin}/`)).rejects.toThrow();
  }, 60_000);
});
