import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MORPH_ASTRO_COMPILER_RS_VERSION } from "./astro-compiler-version";

type LockEntry = { version?: string; dependencies?: Record<string, string> };
const lock = JSON.parse(
  readFileSync("sandbox/toolchains/astro-7.3/package-lock.json", "utf8"),
) as { packages: Record<string, LockEntry> };

/** `^x.y.z` as npm reads it, for the 0.x and 1+ cases this needs. */
function satisfiesCaret(version: string, range: string): boolean {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || !parsed) return false;
  const [, rMajor, rMinor, rPatch] = match.map(Number);
  const [, major, minor, patch] = parsed.map(Number);
  if (rMajor > 0) {
    return (
      major === rMajor &&
      (minor > rMinor || (minor === rMinor && patch >= rPatch))
    );
  }
  if (rMinor > 0) return major === 0 && minor === rMinor && patch >= rPatch;
  return major === 0 && minor === 0 && patch === rPatch;
}

describe("Morph's .astro parser and the Astro toolchain", () => {
  it("use the same @astrojs/compiler-rs", () => {
    const installed =
      lock.packages["node_modules/@astrojs/compiler-rs"]?.version;
    expect(installed).toBe(MORPH_ASTRO_COMPILER_RS_VERSION);
  });

  it("pin a version astro itself accepts", () => {
    const required =
      lock.packages["node_modules/astro"]?.dependencies?.[
        "@astrojs/compiler-rs"
      ];
    expect(required).toBeDefined();
    expect(satisfiesCaret(MORPH_ASTRO_COMPILER_RS_VERSION, required!)).toBe(
      true,
    );
  });

  it("would notice a version astro does not accept", () => {
    expect(satisfiesCaret("0.6.0", "^0.5.0")).toBe(false);
    expect(satisfiesCaret("0.4.9", "^0.5.0")).toBe(false);
    expect(satisfiesCaret("0.5.9", "^0.5.0")).toBe(true);
  });

  it("installs the native binding the Sandbox platform needs", () => {
    expect(
      lock.packages["node_modules/@astrojs/compiler-binding-linux-x64-gnu"]
        ?.version,
    ).toBe(MORPH_ASTRO_COMPILER_RS_VERSION);
  });
});
