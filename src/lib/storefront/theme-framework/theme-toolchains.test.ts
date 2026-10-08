import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SANDBOX_TOOLCHAIN_ROOT } from "../compiler/theme-preview-dev-server";
import { GENERATED_SANDBOX_TOOLCHAINS } from "./theme-toolchains.generated";
import {
  SANDBOX_PLATFORM_WRANGLER_BIN,
  registeredThemeToolchains,
  shortToolchainId,
  themeToolchainById,
  themeToolchainForFramework,
} from "./theme-toolchains";

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the Sandbox toolchain registry", () => {
  it("names each toolchain by a full SHA-256 identity, one per framework", () => {
    const toolchains = registeredThemeToolchains();
    expect(toolchains.map((t) => t.framework).sort()).toEqual([
      "astro",
      "tanstack-start",
    ]);
    for (const toolchain of toolchains) {
      expect(toolchain.id).toMatch(/^[0-9a-f]{64}$/);
      expect(toolchain.root.startsWith("/opt/morph-toolchain/")).toBe(true);
      expect(toolchain.manifestPath).toBe(
        `${toolchain.root}/toolchain.manifest.json`,
      );
      expect(themeToolchainForFramework(toolchain.framework)).toBe(toolchain);
      expect(themeToolchainById(toolchain.id)).toBe(toolchain);
    }
  });

  it("finds nothing for an unknown or malformed identity, and never a prefix match", () => {
    const start = themeToolchainForFramework("tanstack-start");
    expect(themeToolchainById("0".repeat(64))).toBeNull();
    expect(themeToolchainById(shortToolchainId(start.id))).toBeNull();
    expect(themeToolchainById(start.id.toUpperCase())).toBeNull();
    expect(themeToolchainById("../../etc")).toBeNull();
  });

  it("was generated from the lockfiles in this repository", () => {
    // The generator refuses an image whose package.json or lockfile differs
    // from these; this keeps the committed registry and files in step.
    const byFramework = Object.fromEntries(
      GENERATED_SANDBOX_TOOLCHAINS.map((t) => [t.framework, t]),
    );
    for (const [framework, directory] of [
      ["tanstack-start", "sandbox/toolchains/tanstack-start-1.168"],
      ["astro", "sandbox/toolchains/astro-7.3"],
    ] as const) {
      expect(byFramework[framework].packageJsonSha256).toBe(
        sha256(`${directory}/package.json`),
      );
      expect(byFramework[framework].packageLockSha256).toBe(
        sha256(`${directory}/package-lock.json`),
      );
    }
  });

  it("keeps the dev-server default root equal to the registry's Start root", () => {
    expect(SANDBOX_TOOLCHAIN_ROOT).toBe(
      themeToolchainForFramework("tanstack-start").root,
    );
  });

  it("runs platform tools from their own root, not a Theme toolchain's", () => {
    expect(SANDBOX_PLATFORM_WRANGLER_BIN).toBe(
      "/opt/morph-platform/node_modules/.bin/wrangler",
    );
    for (const toolchain of registeredThemeToolchains()) {
      expect(SANDBOX_PLATFORM_WRANGLER_BIN.startsWith(toolchain.root)).toBe(
        false,
      );
    }
  });

  it("pins every direct dependency of every toolchain to an exact version", () => {
    for (const toolchain of GENERATED_SANDBOX_TOOLCHAINS) {
      for (const [name, version] of Object.entries(
        toolchain.directDependencies,
      )) {
        expect(version, `${toolchain.framework} ${name}`).toMatch(
          /^\d+\.\d+\.\d+$/,
        );
      }
    }
  });
});
