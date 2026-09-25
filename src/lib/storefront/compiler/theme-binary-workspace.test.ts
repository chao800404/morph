// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import {
  encodeBase64,
  writeSandboxWorkspaceFile,
  type SandboxFileWriter,
} from "./sandbox-file-writer";
import {
  isBinaryWorkspaceFile,
  materializeThemeSandboxWorkspace,
  planThemeSandboxWorkspace,
  WORKSPACE_BINARY_CONCURRENCY,
  type ThemeWorkspaceFile,
  type ThemeWorkspaceWriter,
} from "./theme-sandbox-workspace";

/**
 * Binary files through the workspace a Theme is served and built from.
 *
 * A plan names binary files by reference and holds no bytes; the bytes are
 * loaded only as each file is written, a bounded number at a time; and a
 * Cloudflare Sandbox is handed them as base64, the only form its `writeFile`
 * stores as bytes.
 */

const ROUTE = {
  path: "src/routes/index.tsx",
  content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: () => null });
`,
};
const ROOT = {
  path: "src/routes/__root.tsx",
  content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
};

function png(size: number, fill = 7) {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

const image = (
  path: string,
  digest: string,
  sizeBytes = 16,
): ThemeWorkspaceFile => ({
  path,
  binary: { digest, sizeBytes },
});

function plan(files: readonly ThemeWorkspaceFile[]) {
  const result = planThemeSandboxWorkspace({
    files,
    entry: ROUTE.path,
    buildId: "binary-test",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode: "build",
  });
  if (!result.ok) throw new Error(result.errorMessage);
  return result;
}

/** A writer that records what reached it, and when. */
function recordingWriter() {
  const written = new Map<string, string | Uint8Array>();
  const writer: ThemeWorkspaceWriter = {
    async writeFile(path, content) {
      written.set(path, content);
    },
    async mkdir() {},
  };
  return { written, writer };
}

describe("planning a workspace with binary files", () => {
  it("names each binary file by reference, and holds none of its bytes", () => {
    const result = plan([
      ROOT,
      ROUTE,
      image("public/images/hero.png", "a".repeat(64), 5_000_000),
    ]);
    const hero = result.workspaceFiles.find(
      (file) => file.path === "/workspace/public/images/hero.png",
    );
    expect(hero).toEqual({
      path: "/workspace/public/images/hero.png",
      binary: { digest: "a".repeat(64), sizeBytes: 5_000_000 },
    });
    for (const file of result.workspaceFiles) {
      if (isBinaryWorkspaceFile(file)) continue;
      expect(typeof file.content).toBe("string");
    }
  });

  it("fingerprints a binary file by its digest", () => {
    const one = plan([ROOT, ROUTE, image("public/a.png", "a".repeat(64))]);
    const same = plan([ROOT, ROUTE, image("public/a.png", "a".repeat(64))]);
    const other = plan([ROOT, ROUTE, image("public/a.png", "b".repeat(64))]);
    expect(same.workspaceFingerprint).toBe(one.workspaceFingerprint);
    expect(other.workspaceFingerprint).not.toBe(one.workspaceFingerprint);
  });
});

describe("materialising binary files", () => {
  it("loads each file as it is written, and never holds more than the bound", async () => {
    const files = Array.from({ length: 7 }, (_, index) =>
      image(`/workspace/public/i${index}.png`, `${index}`.repeat(64), 32),
    );
    const { written, writer } = recordingWriter();
    let maxHeld = 0;
    const loaded: string[] = [];

    await materializeThemeSandboxWorkspace(writer, files, {
      loadBinary: async (_ref, path) => {
        loaded.push(path);
        // Slow enough that every slot fills while earlier loads are pending.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return png(32);
      },
      onBinaryHeld: (held) => {
        maxHeld = Math.max(maxHeld, held);
      },
    });

    expect(maxHeld).toBe(WORKSPACE_BINARY_CONCURRENCY);
    expect(WORKSPACE_BINARY_CONCURRENCY).toBe(2);
    expect(loaded).toHaveLength(7);
    for (const file of files) {
      expect(written.get(file.path)).toEqual(png(32));
    }
  });

  it("refuses bytes of another size than the plan recorded", async () => {
    const { writer } = recordingWriter();
    await expect(
      materializeThemeSandboxWorkspace(
        writer,
        [image("/workspace/public/a.png", "a".repeat(64), 32)],
        { loadBinary: async () => png(31) },
      ),
    ).rejects.toThrow("BINARY_SIZE_MISMATCH");
  });

  it("refuses to lay out a binary file it cannot read", async () => {
    const { writer } = recordingWriter();
    await expect(
      materializeThemeSandboxWorkspace(writer, [
        image("/workspace/public/a.png", "a".repeat(64)),
      ]),
    ).rejects.toThrow("BINARY_LOADER_MISSING");
  });
});

describe("writing into a Cloudflare Sandbox", () => {
  function sandbox() {
    const calls: Array<{ path: string; content: string; encoding?: string }> =
      [];
    const session: SandboxFileWriter = {
      async writeFile(path, content, options) {
        calls.push({ path, content, encoding: options?.encoding });
      },
    };
    return { calls, session };
  }

  it("passes text as it is", async () => {
    const { calls, session } = sandbox();
    await writeSandboxWorkspaceFile(session, "/workspace/a.ts", "export {};");
    expect(calls).toEqual([
      { path: "/workspace/a.ts", content: "export {};", encoding: undefined },
    ]);
  });

  it("hands bytes over as base64, which decodes to the same bytes", async () => {
    const { calls, session } = sandbox();
    // Near the per-file limit, so the encoding is exercised at the size it
    // will see; and a view into a larger buffer, as a blob read can return.
    const backing = new Uint8Array(5 * 1024 * 1024 + 16);
    backing.set(png(5 * 1024 * 1024, 3), 8);
    const bytes = backing.subarray(8, 8 + 5 * 1024 * 1024);

    await writeSandboxWorkspaceFile(session, "/workspace/public/a.png", bytes);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.encoding).toBe("base64");
    const decoded = new Uint8Array(Buffer.from(calls[0]!.content, "base64"));
    expect(decoded.byteLength).toBe(bytes.byteLength);
    expect(Buffer.compare(decoded, bytes)).toBe(0);
  });

  it("encodes exactly the viewed bytes of a shared buffer", () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);
    expect(encodeBase64(backing.subarray(1, 4))).toBe(
      Buffer.from([1, 2, 3]).toString("base64"),
    );
  });
});
