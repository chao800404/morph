// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { LocalViteThemeBuildRunner } from "../compiler/local-vite-theme-build-runner";
import { materializeThemeBuildInput } from "../compiler/theme-build-materializer";
import { nativeAstroAllowedPackages } from "../theme-framework/astro-native-build";
import { astroToolchainInstalled } from "../theme-framework/astro-native-prerender.test-support";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { isThemePublicPath } from "../theme-public-files";

/**
 * docs/astro-theme-plan.md A4: official Astro projects for Cloudflare, copied
 * unchanged from upstream (fixtures/astro/SOURCES.json), through the gates an
 * Astro build passes today — the materializer, then a real build with the
 * pinned Astro toolchain.
 *
 * Each `KNOWN GAP` asserts where Morph refuses the project today, at the first
 * gate that refuses it; it fails the moment the gap closes, and then becomes
 * an ordinary assertion. What lies behind a first refusal is recorded in the
 * plan (5.2.3), not asserted here.
 */

const FIXTURES = join(process.cwd(), "fixtures", "astro");
const ASTRO = themeToolchainForFramework("astro");

type FixtureFile = { path: string; bytes: Buffer };

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function fixture(name: string): FixtureFile[] {
  const root = join(FIXTURES, name);
  return walk(root)
    .map((full) => ({
      path: relative(root, full).split(sep).join("/"),
      bytes: readFileSync(full),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const sources = JSON.parse(
  readFileSync(join(FIXTURES, "SOURCES.json"), "utf8"),
) as Record<string, { upstreamBlobs: Record<string, string> }>;

const blob = (bytes: Buffer) =>
  createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");

/** The project as a stored source revision holds it: public/ by digest. */
function snapshot(files: FixtureFile[]) {
  return files.map((file) =>
    isThemePublicPath(file.path)
      ? {
          path: file.path,
          encoding: "binary",
          blobDigest: createHash("sha256").update(file.bytes).digest("hex"),
          sizeBytes: file.bytes.byteLength,
        }
      : { path: file.path, content: file.bytes.toString("utf8") },
  );
}

function materialize(files: FixtureFile[]) {
  return materializeThemeBuildInput({
    build: {
      id: "official-astro",
      storefrontId: "store",
      themeId: "theme",
      sourceRevisionId: "rev",
      status: "queued",
      inputHash: null,
      compilerId: null,
      compilerVersion: null,
      contentPublicationId: null,
      framework: "astro",
      inputHashFormat: 2,
      toolchainId: ASTRO.id,
    } as StorefrontThemeBuildDTO,
    revision: {
      id: "rev",
      storefrontId: "store",
      themeId: "theme",
      revisionNumber: 1,
      snapshot: snapshot(files),
    } as unknown as StorefrontThemeRevisionDTO,
    astroThemes: true,
  });
}

const NAMES = [
  "cloudflare-astro-blog-starter",
  "adapter-sessions",
  "adapter-compile-image-service",
  "adapter-with-react",
] as const;

describe("official Astro fixtures, imported unchanged", () => {
  for (const name of NAMES) {
    it(`${name} is byte-identical to the recorded upstream commit`, () => {
      expect(
        Object.fromEntries(
          fixture(name).map((file) => [file.path, blob(file.bytes)]),
        ),
      ).toEqual(sources[name]!.upstreamBlobs);
    });
  }

  describe("KNOWN GAP: Cloudflare's Astro starter", () => {
    const files = fixture("cloudflare-astro-blog-starter");
    const manifest = JSON.parse(
      files.find((file) => file.path === "package.json")!.bytes.toString("utf8"),
    ) as { dependencies: Record<string, string> };

    it("is refused before it is queued, for the dot-file it ships in public/", () => {
      expect(() => materialize(files)).toThrow(
        /^PUBLIC_FILE_REFUSED: .*public\/\.assetsignore/,
      );
    });

    it("pins an Astro and adapter older than Morph's Astro toolchain", () => {
      expect(manifest.dependencies.astro).toBe("5.16.9");
      expect(manifest.dependencies["@astrojs/cloudflare"]).toBe("12.6.12");
      expect(ASTRO.directDependencies.astro).not.toBe(
        manifest.dependencies.astro,
      );
      expect(ASTRO.directDependencies["@astrojs/cloudflare"]).not.toBe(
        manifest.dependencies["@astrojs/cloudflare"],
      );
    });

    it("uses integrations the Astro toolchain does not have", () => {
      const allowed = new Set(nativeAstroAllowedPackages());
      const missing = Object.keys(manifest.dependencies)
        .filter((dependency) => !allowed.has(dependency))
        .sort();
      expect(missing).toEqual(
        expect.arrayContaining(["@astrojs/mdx", "@astrojs/rss", "@astrojs/sitemap"]),
      );
    });
  });

  describe("KNOWN GAP: the adapter's own fixtures", () => {
    for (const name of ["adapter-compile-image-service", "adapter-with-react"]) {
      it(`${name} has no Wrangler config, which Morph requires`, () => {
        expect(() => materialize(fixture(name))).toThrow(
          /^NATIVE_WRANGLER_CONFIG: The project has no wrangler\.jsonc/,
        );
      });
    }

    it("adapter-compile-image-service keeps its image under src/, where Morph holds only text", () => {
      // Astro's image pipeline reads images imported from src/; a Morph source
      // revision holds bytes only in public/, so this one cannot be stored as
      // it is, and imageService "compile" stays unverified (plan 5.2).
      const image = fixture("adapter-compile-image-service").find((file) =>
        file.path.endsWith(".jpg"),
      )!;
      expect(image.path).toBe("src/content/blog/post/placeholder.jpg");
      expect(isThemePublicPath(image.path)).toBe(false);
      expect(image.bytes.toString("utf8").includes("�")).toBe(true);
    });

    it.skipIf(!astroToolchainInstalled)(
      "adapter-sessions builds, and is refused for its SESSION binding",
      { timeout: 300_000 },
      async () => {
        const result = await new LocalViteThemeBuildRunner({
          maxDurationMs: 240_000,
          astroThemes: true,
        }).run(materialize(fixture("adapter-sessions")));
        expect(result).toMatchObject({
          success: false,
          diagnosticsJson: { stage: "output-collection" },
          errorMessage: expect.stringMatching(
            /^ASTRO_SESSION_BINDING_UNSUPPORTED: /,
          ),
        });
      },
    );
  });
});
