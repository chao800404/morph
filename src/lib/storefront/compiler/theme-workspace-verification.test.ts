// @vitest-environment node
import { describe, expect, it } from "vitest";
import { workspaceFileDigests } from "./preview-server-observation";
import {
  isDirtyWorkspaceMarker,
  newDirtyWorkspaceMarker,
} from "./theme-workspace-path";
import { verifyWorkspaceOnDisk } from "./theme-workspace-verification";

const PLAN = [
  { path: "/workspace/src/routes/index.tsx", content: "export default 1;" },
  { path: "/workspace/vite.config.ts", content: "export default {};" },
];

const disk = (files: Record<string, string>, extra: string[] = []) => ({
  async readFile(path: string) {
    if (!(path in files)) throw new Error("ENOENT");
    return { content: files[path] };
  },
  async listFiles() {
    return {
      success: true,
      files: [...Object.keys(files), ...extra].map((absolutePath) => ({
        absolutePath,
        type: "file",
      })),
    };
  },
});

describe("verifyWorkspaceOnDisk", () => {
  it("digests every planned file as it is on disk", async () => {
    const result = await verifyWorkspaceOnDisk(
      disk({
        "/workspace/src/routes/index.tsx": "export default 1;",
        "/workspace/vite.config.ts": "changed",
      }),
      PLAN,
    );
    expect(result).toEqual({
      ok: true,
      read: 2,
      onDisk: {
        ...workspaceFileDigests([PLAN[0]!]),
        ...workspaceFileDigests([
          { path: "/workspace/vite.config.ts", content: "changed" },
        ]),
      },
    });
  });

  it("leaves out a file it cannot read, so it counts as different", async () => {
    const result = await verifyWorkspaceOnDisk(
      disk({ "/workspace/src/routes/index.tsx": "export default 1;" }),
      PLAN,
    );
    expect(result.ok && Object.keys(result.onDisk)).toEqual([
      "/workspace/src/routes/index.tsx",
    ]);
  });

  it("refuses a workspace holding a file no plan accounts for", async () => {
    expect(
      await verifyWorkspaceOnDisk(
        disk(
          {
            "/workspace/src/routes/index.tsx": "export default 1;",
            "/workspace/vite.config.ts": "export default {};",
          },
          ["/workspace/src/stray.ts"],
        ),
        PLAN,
      ),
    ).toEqual({ ok: false, reason: "unplanned-files" });
  });

  it("ignores the toolchain, caches and its own markers when listing", async () => {
    const result = await verifyWorkspaceOnDisk(
      disk(
        {
          "/workspace/src/routes/index.tsx": "export default 1;",
          "/workspace/vite.config.ts": "export default {};",
        },
        [
          "/workspace/node_modules/vite/index.js",
          "/workspace/.vite/deps/react.js",
          "/workspace/.morph-preview-workspace.sha256",
          "/workspace/.morph-preview-workspace.manifest.json",
        ],
      ),
      PLAN,
    );
    expect(result.ok).toBe(true);
  });

  it("does not guess at bytes, or at a workspace it cannot read", async () => {
    expect(
      await verifyWorkspaceOnDisk(disk({}), [
        { path: "/workspace/logo.png", content: new Uint8Array([1]) },
      ]),
    ).toEqual({ ok: false, reason: "binary-file" });
    expect(await verifyWorkspaceOnDisk({}, PLAN)).toEqual({
      ok: false,
      reason: "no-reader",
    });
    expect(
      await verifyWorkspaceOnDisk(
        {
          readFile: async () => "",
          listFiles: async () => ({ success: false, files: [] }),
        },
        PLAN,
      ),
    ).toEqual({ ok: false, reason: "unlistable" });
  });
});

describe("dirty workspace markers", () => {
  it("carry a token each, and are all recognised as dirty", () => {
    const first = newDirtyWorkspaceMarker();
    const second = newDirtyWorkspaceMarker();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^dirty:[0-9a-f]{8}$/);
    for (const marker of [first, "dirty"]) {
      expect(isDirtyWorkspaceMarker(marker)).toBe(true);
    }
    for (const marker of ["3f2a9c", "dirtyish", null]) {
      expect(isDirtyWorkspaceMarker(marker)).toBe(false);
    }
  });
});
