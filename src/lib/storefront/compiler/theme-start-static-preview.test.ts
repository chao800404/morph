// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import {
  NATIVE_COMPAT_SERVER_HELPER_FILES,
  SERVER_HELPER_SENTINEL,
} from "../compat/native-compat-server-helper";
import {
  planThemeSandboxWorkspace,
  materializeThemeSandboxWorkspace,
} from "./theme-sandbox-workspace";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

describe("the generated Sandbox static preview config", () => {
  it("uses Start to remove .server implementation while retaining the static HTML contract", async () => {
    const workspace = await fs.mkdtemp(
      path.join(process.cwd(), ".morph-static-boundary-"),
    );
    const localPath = (file: string) => {
      if (file !== "/workspace" && !file.startsWith("/workspace/"))
        throw new Error("unexpected workspace path");
      return path.join(workspace, file.slice("/workspace".length));
    };
    try {
      const plan = planThemeSandboxWorkspace({
        files: [...STARTER_THEME_FILES, ...NATIVE_COMPAT_SERVER_HELPER_FILES],
        entry: "src/routes/index.tsx",
        buildId: "static-server-boundary",
        approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
        mode: "build",
        hostWorkspaceRoot: workspace,
        toolchainRoot: process.cwd(),
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.errorMessage);
      await materializeThemeSandboxWorkspace(
        {
          async mkdir(file) {
            await fs.mkdir(localPath(file), { recursive: true });
          },
          async writeFile(file, content) {
            await fs.writeFile(localPath(file), content);
          },
        },
        plan.workspaceFiles,
      );
      await fs.symlink(
        path.join(process.cwd(), "node_modules"),
        path.join(workspace, "node_modules"),
        "dir",
      );
      // Execute the very config the Sandbox CLI receives, not a copied
      // in-process config. This remains local evidence, not a container test.
      await promisify(execFile)(
        process.execPath,
        [
          path.join(process.cwd(), "node_modules/vite/bin/vite.js"),
          "build",
          "--config",
          path.join(workspace, "vite.config.ts"),
        ],
        {
          cwd: workspace,
          env: {
            ...process.env,
            NODE_ENV: "production",
            MORPH_THEME_BUILD_TARGET: "preview",
          },
          timeout: 120_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      const outDir = path.join(workspace, "dist/preview");
      const html = await fs.readFile(path.join(outDir, "index.html"), "utf8");
      const entries = await fs.readdir(outDir, { recursive: true });
      const scripts = await Promise.all(
        entries
          .filter((file) => file.endsWith(".js"))
          .map((file) => fs.readFile(path.join(outDir, file), "utf8")),
      );
      expect(scripts.length).toBeGreaterThan(0);
      expect(scripts.join("\n")).not.toContain(SERVER_HELPER_SENTINEL);
      expect(scripts.join("\n")).not.toContain("x-private-case");
      for (const match of html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)) {
        await expect(
          fs.stat(path.join(outDir, match[1]!)),
        ).resolves.toBeDefined();
      }
      expect(html).toMatch(/src="\.\/assets\//);
      // A static artifact must not silently build a second server.
      await expect(
        fs.stat(path.join(workspace, "dist/preview/server")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }, 150_000);
});
