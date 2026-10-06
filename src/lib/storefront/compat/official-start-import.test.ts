// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  safeThemeFilePathSchema,
  themeTextFilePathSchema,
} from "@/lib/validations/storefront-theme-file";
import { DEFAULT_APPROVED_DEPENDENCIES } from "../compiler/sandbox-vite-theme-build-runner.types";
import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import {
  isPlatformOwnedThemeBuildPath,
  THEME_START_TOOLCHAIN,
  validateThemeStartPackageContract,
} from "../compiler/theme-start-toolchain";
import { refuseThemeWorkspacePath } from "../compiler/theme-workspace-path";

/**
 * Step 0 of docs/start-native-import-plan.md: an official TanStack Start
 * project, copied unchanged from upstream, meets each gate a Morph import
 * passes through today.
 *
 * The claim is "a project written by the official docs is accepted without
 * being rewritten into Morph's shape". Where Morph still refuses it, a
 * `KNOWN GAP` test asserts the refusal, so it fails the moment the gap closes
 * and has to become an ordinary assertion. Gaps with no Morph component to
 * assert against yet are `it.todo`.
 *
 * Builds are not run here; this is the cheap preflight that CI runs on
 * every pull request.
 */

const FIXTURES = join(process.cwd(), "fixtures", "tanstack");
const NAME = "start-basic-cloudflare";
const PROJECT = join(FIXTURES, NAME);
const LOCKFILE = "pnpm-lock.yaml";

type FixtureFile = { path: string; bytes: Buffer };

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files: FixtureFile[] = walk(PROJECT)
  .map((full) => ({
    path: relative(PROJECT, full).split(sep).join("/"),
    bytes: readFileSync(full),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const BINARY = /\.(?:png|ico|jpe?g|gif|webp|woff2?)$/i;
const textFiles = files
  .filter((file) => !BINARY.test(file.path))
  .map((file) => ({ path: file.path, content: file.bytes.toString("utf8") }));
const text = (path: string) =>
  textFiles.find((file) => file.path === path)!.content;

const sources = JSON.parse(
  readFileSync(join(FIXTURES, "SOURCES.json"), "utf8"),
)[NAME] as { commit: string; upstreamBlobs: Record<string, string> };

/** The version pnpm resolved for a direct dependency of the project. */
function lockedVersion(name: string): string | null {
  const lock = text(LOCKFILE);
  const importer = lock.slice(
    lock.indexOf("importers:"),
    lock.indexOf("\npackages:"),
  );
  const quoted = name.startsWith("@") ? `'${name}'` : name;
  const match = new RegExp(
    `\\n {6}${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\n {8}specifier: [^\\n]+\\n {8}version: ([^\\s(]+)`,
  ).exec(importer);
  return match?.[1] ?? null;
}

describe(`official fixture ${NAME}, imported unchanged`, () => {
  it("is byte-identical to the recorded upstream commit, plus only a generated lockfile", () => {
    const blob = (bytes: Buffer) =>
      createHash("sha1")
        .update(`blob ${bytes.byteLength}\0`)
        .update(bytes)
        .digest("hex");
    const actual = Object.fromEntries(
      files
        .filter((file) => file.path !== LOCKFILE)
        .map((file) => [file.path, blob(file.bytes)]),
    );
    expect(actual).toEqual(sources.upstreamBlobs);
    expect(files.map((file) => file.path)).toContain(LOCKFILE);
  });

  it("uses only file paths Morph accepts", () => {
    for (const file of files) {
      expect(
        safeThemeFilePathSchema.safeParse(file.path).success,
        file.path,
      ).toBe(true);
    }
    for (const file of textFiles.filter((f) => !f.path.startsWith("public/"))) {
      expect(
        themeTextFilePathSchema.safeParse(file.path).success,
        file.path,
      ).toBe(true);
    }
  });

  it("reads as a TanStack Start route tree in Code mode", () => {
    const registry = buildThemeRouteRegistry(textFiles);
    expect(registry.diagnostics).toEqual([]);
    expect(registry.valid).toBe(true);
    const paths = registry.routes.map((route) => route.fullPath);
    for (const path of ["/", "/posts", "/users", "/deferred", "/redirect"]) {
      expect(paths).toContain(path);
    }
  });

  describe("KNOWN GAP", () => {
    it("package.json must pin Morph's toolchain versions instead of the official ranges", () => {
      const diagnostics = validateThemeStartPackageContract(textFiles);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.join("\n")).toMatch(
        /must equal the supported version/,
      );
    });

    it("the official Cloudflare starter requires an uncertified Vite 8 Theme toolchain", () => {
      expect(lockedVersion("vite")).toMatch(/^8\./);
      expect(lockedVersion("@tanstack/react-start")).toBe("1.168.60");
      // Morph builds every Theme with one pinned toolchain; there is no
      // compatibility matrix yet in which this combination is certified.
      expect(THEME_START_TOOLCHAIN.vite).not.toBe(lockedVersion("vite"));
      expect(THEME_START_TOOLCHAIN.reactStart).not.toBe(
        lockedVersion("@tanstack/react-start"),
      );
    });

    it("vite.config.ts and wrangler.jsonc are platform-owned, so the project's own cannot be imported", () => {
      for (const path of ["vite.config.ts", "wrangler.jsonc"]) {
        expect(files.map((file) => file.path)).toContain(path);
        expect(isPlatformOwnedThemeBuildPath(path)).toBe(true);
        expect(refuseThemeWorkspacePath(path)).toMatch(
          /^RESERVED_THEME_BUILD_PATH/,
        );
      }
    });

    it("packages the project declares are outside the approved Theme dependencies", () => {
      const manifest = JSON.parse(text("package.json")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const approved = new Set(DEFAULT_APPROVED_DEPENDENCIES);
      const declared = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ];
      const outside = declared.filter((name) => !approved.has(name)).sort();
      expect(outside.length).toBeGreaterThan(0);
      expect(outside).toContain("@tanstack/react-router-devtools");
    });

    it.todo("project-defined build scripts are not executed yet");
    it.todo(
      "dependency and project lifecycle scripts have no policy yet (this project's postinstall runs `wrangler types`)",
    );
    it.todo(
      "build and runtime egress allow-lists do not exist yet (this project's loaders fetch an external API)",
    );
    it.todo(
      "Cloudflare infrastructure in wrangler.jsonc (vars, bindings) is not mapped yet",
    );
  });
});
