// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LocalPreviewSidecarClient } from "./local-preview-sidecar-client";

// What a Worker env holds next to the vars a preview start needs. None of it
// may leave the Worker for the sidecar process.
const WORKER_ENV = {
  PUBLIC_URL: "https://admin.example.net",
  MORPH_PLATFORM_HOSTNAMES: "cms.example.net",
  MORPH_CMS_HOSTNAME: "cms.example.net",
  BETTER_AUTH_SECRET: "better-auth-secret-value",
  THEME_PREVIEW_SECRET: "theme-preview-secret-value",
  DB: { prepare: () => undefined },
};

const capturingClient = () => {
  const bodies: string[] = [];
  const client = new LocalPreviewSidecarClient({
    origin: "http://127.0.0.1:5199",
    token: "t".repeat(32),
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ ok: false, stage: "stub", errorMessage: "stub", logs: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });
  return { client, bodies };
};

describe("what a start carries to the local preview sidecar", () => {
  it("sends the platform hostname vars and nothing else of the Worker env", async () => {
    const { client, bodies } = capturingClient();
    await client.start({
      previewId: "preview-1",
      files: [],
      entry: "src/pages/index.tsx",
      previewHostname: "127.0.0.1",
      // A caller that hands over the whole env, as the server function did.
      platformHostEnv: WORKER_ENV as never,
    });

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    for (const key of ["BETTER_AUTH_SECRET", "THEME_PREVIEW_SECRET", "DB"]) {
      expect(body).not.toContain(key);
    }
    expect(body).not.toContain("better-auth-secret-value");
    expect(body).not.toContain("theme-preview-secret-value");
    expect(JSON.parse(body).platformHostEnv).toEqual({
      PUBLIC_URL: "https://admin.example.net",
      MORPH_PLATFORM_HOSTNAMES: "cms.example.net",
      MORPH_CMS_HOSTNAME: "cms.example.net",
    });
  });
});
