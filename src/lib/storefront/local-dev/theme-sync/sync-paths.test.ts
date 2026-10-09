import { describe, expect, it } from "vitest";
import { themeSyncPathExclusion } from "./sync-paths";

describe("the paths local sync carries", () => {
  it.each([
    "src/routes/index.tsx",
    "src/components/Hero.tsx",
    "package.json",
    "vite.config.ts",
    "src/styles.css",
    "README.md",
  ])("carries %s", (path) => {
    expect(themeSyncPathExclusion(path)).toBeNull();
  });

  it.each([
    ["node_modules/react/index.js", "local-only"],
    [".git/config", "local-only"],
    ["dist/server.js", "local-only"],
    [".morph/sync-state.json", "local-only"],
    [".env", "local-only"],
    [".env.local", "local-only"],
    [".dev.vars", "local-only"],
    ["src/routes/index.tsx.morph-remote", "local-only"],
    ["__entry.tsx", "platform-owned"],
    ["__morph_preview_worker.ts", "platform-owned"],
    ["src/routeTree.gen.ts", "generated"],
    ["morph.theme.json", "legacy-manifest"],
    ["public/logo.png", "binary-directory"],
    ["src/my file.tsx", "invalid-path"],
    ["../outside.ts", "invalid-path"],
    ["/etc/passwd", "invalid-path"],
  ])("leaves out %s (%s)", (path, reason) => {
    expect(themeSyncPathExclusion(path)).toBe(reason);
  });
});
