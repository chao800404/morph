// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalThemeWorkspaceWriter } from "./local-theme-workspace-writer";
import { materializeThemeSandboxWorkspace } from "./theme-sandbox-workspace";

/**
 * A Theme workspace on disk, laid out by the sandbox's own materializer.
 *
 * This is the claim the local preview transport rests on: laying out a
 * workspace is writing files, so the code that does it for a container does it
 * for a directory once it is given a writer. What is checked here is not "the
 * adapter writes files" but that the *materializer's* behaviour survives the
 * change of substrate — parent-first ordering, stale-file reconciliation, and
 * the things a dev server owns being left alone.
 *
 * Node environment: this exercises the real filesystem, not a jsdom shim.
 */

const roots: string[] = [];

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "morph-theme-ws-"));
  roots.push(root);
  return { root, writer: new LocalThemeWorkspaceWriter({ root }) };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("materializing a Theme workspace into a local directory", () => {
  it("writes nested files, creating the directories first", async () => {
    const { root, writer } = await workspace();

    await materializeThemeSandboxWorkspace(writer, [
      { path: "/workspace/src/components/Hero.tsx", content: "hero" },
      { path: "/workspace/src/routes/index.tsx", content: "index" },
    ]);

    await expect(
      fs.readFile(path.join(root, "src/components/Hero.tsx"), "utf8"),
    ).resolves.toBe("hero");
    await expect(
      fs.readFile(path.join(root, "src/routes/index.tsx"), "utf8"),
    ).resolves.toBe("index");
  });

  it("removes what an older plan left, and leaves the dev server's own things", async () => {
    const { root, writer } = await workspace();
    // What a warm workspace has and a plan never names: dependencies, a Vite
    // cache. The materializer spares both by name, which is the same rule that
    // protects the sandbox image's toolchain.
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.mkdir(path.join(root, ".vite"), { recursive: true });
    await fs.writeFile(path.join(root, ".vite/cache.json"), "{}");

    await materializeThemeSandboxWorkspace(writer, [
      { path: "/workspace/src/components/Hero.tsx", content: "hero" },
      { path: "/workspace/src/routes/index.tsx", content: "index" },
    ]);
    await materializeThemeSandboxWorkspace(writer, [
      { path: "/workspace/src/routes/index.tsx", content: "index" },
    ]);

    // Gone, because a deleted component could still satisfy an old import.
    await expect(
      fs.access(path.join(root, "src/components/Hero.tsx")),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(root, "src/routes/index.tsx"), "utf8"),
    ).resolves.toBe("index");
    // Kept: dependencies and the dev server's cache are not the plan's to remove.
    await expect(
      fs.access(path.join(root, "node_modules")),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(root, ".vite/cache.json"), "utf8"),
    ).resolves.toBe("{}");
  });

  it("refuses a path that would escape the workspace root", async () => {
    const { writer } = await workspace();

    await expect(
      writer.writeFile("/workspace/../outside.txt", "nope"),
    ).rejects.toThrow(/outside the root/);
  });
});
