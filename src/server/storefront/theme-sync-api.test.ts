import { describe, expect, it, vi } from "vitest";
import {
  createFakeCapabilities,
  createFakeWorkspace,
  TEST_TOKEN,
} from "@/lib/storefront/local-dev/theme-sync/sync-test-harness";
import { handleThemeSyncRequest } from "./theme-sync-api";

vi.mock("cloudflare:workers", () => ({ env: {} }));

function setup(morph: Record<string, string> = { "a.tsx": "a" }) {
  const workspace = createFakeWorkspace(morph);
  const dal = createFakeCapabilities();
  const call = (
    route: string,
    init: { method?: string; body?: unknown; token?: string | null; contentType?: string } = {},
  ) =>
    handleThemeSyncRequest(
      new Request(`http://morph.test/api/storefront/theme-sync/${route}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? TEST_TOKEN}` }),
          ...(init.body === undefined
            ? {}
            : { "content-type": init.contentType ?? "application/json" }),
        },
        body:
          init.body === undefined
            ? undefined
            : typeof init.body === "string"
              ? init.body
              : JSON.stringify(init.body),
      }),
      { dal, ...workspace.deps },
    );
  return { workspace, dal, call };
}

const save = (files: unknown[], deletions: unknown[] = [], expectedSourceGeneration = 1) => ({
  body: { expectedSourceGeneration, files, deletions },
});

describe("the local sync API", () => {
  it.each([
    ["no token", null],
    ["an admin API key", `sk_${"a".repeat(40)}`],
    ["an unknown sync token", `mts_${"b".repeat(40)}`],
  ])("refuses a request with %s before reading anything", async (_name, token) => {
    const { call, workspace } = setup();
    const getSnapshot = vi.spyOn(workspace.deps, "getWorkspaceSnapshot");
    const response = await call("files", { token });
    expect(response.status).toBe(401);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("refuses a revoked token", async () => {
    const { call, dal } = setup();
    dal.revoked = true;
    const response = await call("whoami");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ reason: "CAPABILITY_REVOKED" });
  });

  it("names the store and Theme the token is for, and nothing else", async () => {
    const { call } = setup();
    expect(await (await call("whoami")).json()).toEqual({
      protocol: 1,
      storefrontId: "store-a",
      themeId: "theme-a",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
  });

  it("lists the files sync carries, with binary files marked, and no content", async () => {
    const { call, workspace } = setup({
      "a.tsx": "secret body",
      "src/routeTree.gen.ts": "generated",
      "__entry.tsx": "platform",
    });
    workspace.addBinary("src/photo.png");
    const body = (await (await call("files")).json()) as {
      sourceGeneration: number;
      files: Array<{ path: string; kind: string }>;
    };
    expect(body.sourceGeneration).toBe(2);
    expect(body.files.map((file) => [file.path, file.kind])).toEqual([
      ["a.tsx", "text"],
      ["src/photo.png", "binary"],
    ]);
    expect(JSON.stringify(body)).not.toContain("secret body");
  });

  it("reads the generation before the files", async () => {
    const { call, workspace } = setup();
    const order: string[] = [];
    workspace.deps.getSourceGeneration = async () => {
      order.push("generation");
      return 1;
    };
    const snapshot = workspace.deps.getWorkspaceSnapshot;
    workspace.deps.getWorkspaceSnapshot = async (...args) => {
      order.push("files");
      return snapshot(...args);
    };
    await call("files");
    expect(order).toEqual(["generation", "files"]);
  });

  it("reads text files and says which asked-for paths it does not hold", async () => {
    const { call, workspace } = setup({ "a.tsx": "a", "__entry.tsx": "platform" });
    workspace.addBinary("src/photo.png");
    const body = (await (
      await call("files/read", { body: { paths: ["a.tsx", "__entry.tsx", "src/photo.png", "gone.ts"] } })
    ).json()) as { files: unknown[]; missing: string[] };
    expect(body.files).toEqual([
      expect.objectContaining({ path: "a.tsx", content: "a", version: 1 }),
    ]);
    expect(body.missing.sort()).toEqual(["__entry.tsx", "gone.ts", "src/photo.png"]);
  });

  it("saves through the store with the client's preconditions and the holder as author", async () => {
    const { call, workspace } = setup();
    const id = workspace.files.get("a.tsx")!.id;
    const response = await call(
      "files/save",
      save([
        { path: "a.tsx", content: "a2", expectedFileId: id, expectedVersion: 1 },
        { path: "b.tsx", content: "b", expectMissing: true },
      ]),
    );
    expect(response.status).toBe(200);
    expect(workspace.deps.saveFilesBatch).toHaveBeenCalledWith(
      "store-a",
      "theme-a",
      [
        { path: "a.tsx", content: "a2", expectedFileId: id, expectedVersion: 1 },
        { path: "b.tsx", content: "b", expectMissing: true },
      ],
      {
        expectedSourceGeneration: 1,
        deletions: [],
        revisionMessage: "Local sync",
        createdBy: "admin-1",
      },
    );
    expect(((await response.json()) as { sourceGeneration: number }).sourceGeneration).toBe(2);
  });

  it.each([
    ["a platform file", "__entry.tsx", "platform-owned"],
    ["the generated route tree", "src/routeTree.gen.ts", "generated"],
    ["the legacy manifest", "morph.theme.json", "legacy-manifest"],
    ["public/ as text", "public/robots.txt", "binary-directory"],
    ["an env file", ".env", "local-only"],
    ["a path outside the Theme", "../x.ts", "invalid-path"],
  ])("refuses to write %s, whatever the client sends", async (_name, path, reason) => {
    const { call, workspace } = setup();
    const response = await call("files/save", save([{ path, content: "x", expectMissing: true }]));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "PATH_REFUSED",
      refused: [{ path, reason }],
    });
    expect(workspace.deps.saveFilesBatch).not.toHaveBeenCalled();
  });

  it("refuses to delete a platform file", async () => {
    const { call, workspace } = setup({ "__entry.tsx": "platform" });
    const file = workspace.files.get("__entry.tsx")!;
    const response = await call(
      "files/save",
      save([], [{ path: "__entry.tsx", expectedFileId: file.id, expectedVersion: 1 }]),
    );
    expect(response.status).toBe(422);
    expect(workspace.files.has("__entry.tsx")).toBe(true);
  });

  it("refuses a write without a precondition", async () => {
    const { call, workspace } = setup();
    const response = await call("files/save", save([{ path: "a.tsx", content: "x" }]));
    expect(response.status).toBe(400);
    expect(workspace.deps.saveFilesBatch).not.toHaveBeenCalled();
  });

  it("answers a stale generation or version with 409 and writes nothing", async () => {
    const { call, workspace } = setup();
    const id = workspace.files.get("a.tsx")!.id;
    const stale = await call(
      "files/save",
      save([{ path: "a.tsx", content: "x", expectedFileId: id, expectedVersion: 1 }], [], 7),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "SOURCE_GENERATION_CONFLICT" });
    const version = await call(
      "files/save",
      save([{ path: "a.tsx", content: "x", expectedFileId: id, expectedVersion: 9 }]),
    );
    expect(version.status).toBe(409);
    expect(await version.json()).toMatchObject({ error: "FILE_VERSION_CONFLICT" });
    expect(workspace.files.get("a.tsx")!.content).toBe("a");
  });

  it("refuses a file over the size limit", async () => {
    const { call, workspace } = setup();
    const response = await call(
      "files/save",
      save([{ path: "big.ts", content: "x".repeat(1024 * 1024 + 1), expectMissing: true }]),
    );
    expect(response.status).toBe(413);
    expect(workspace.deps.saveFilesBatch).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const { call } = setup();
    const response = await call("files/save", { body: "a=1", contentType: "application/x-www-form-urlencoded" });
    expect(response.status).toBe(400);
  });

  it("revokes its own token on logout", async () => {
    const { call, dal } = setup();
    expect((await call("logout", { method: "POST" })).status).toBe(200);
    expect(dal.revoked).toBe(true);
    expect((await call("whoami")).status).toBe(401);
  });

  it("knows no other routes", async () => {
    const { call } = setup();
    expect((await call("publish", { method: "POST" })).status).toBe(404);
  });
});
