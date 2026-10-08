// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import {
  computeThemeInputHash,
  serializeCompilerInput,
} from "./theme-compiler-hasher";

// docs/astro-theme-plan.md 2.2.1: a build is hashed and verified only by the
// format it records. Legacy (no format) is unchanged; format 2 always hashes
// the recorded framework and toolchain identity, never "the current one".

const START = themeToolchainForFramework("tanstack-start");
const ASTRO = themeToolchainForFramework("astro");

const revision = {
  id: "rev-1",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  revisionNumber: 1,
  snapshot: [
    {
      path: "src/index.tsx",
      content: "export default () => <h1>Home</h1>;",
      isEntry: true,
    },
  ],
} as unknown as StorefrontThemeRevisionDTO;

const build = (
  overrides: Partial<StorefrontThemeBuildDTO> = {},
): StorefrontThemeBuildDTO =>
  ({
    id: "build-1",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    status: "queued",
    inputHash: null,
    compilerId: null,
    compilerVersion: null,
    contentPublicationId: null,
    ...overrides,
  }) as StorefrontThemeBuildDTO;

const format2 = (overrides: Partial<StorefrontThemeBuildDTO> = {}) =>
  build({
    framework: "tanstack-start",
    inputHashFormat: 2,
    toolchainId: START.id,
    ...overrides,
  });

describe("a build's inputHash format", () => {
  it("leaves a legacy build's hash exactly as legacy serialization computes it", () => {
    const legacy = materializeThemeBuildInput({ build: build(), revision });
    expect(legacy.inputHashFormat).toBeUndefined();
    expect(legacy.toolchainId).toBeUndefined();
    const { inputHashFormat: _f, toolchainId: _t, ...legacyInput } = legacy;
    expect(
      computeThemeInputHash(legacyInput, {
        id: legacy.compilerId,
        version: legacy.compilerVersion,
      }),
    ).toBe(legacy.inputHash);
    // And a recorded legacy hash keeps verifying.
    expect(
      materializeThemeBuildInput({
        build: build({ inputHash: legacy.inputHash }),
        revision,
      }).inputHash,
    ).toBe(legacy.inputHash);
  });

  it("hashes format 2 with the framework and toolchain always in it", () => {
    const v2 = materializeThemeBuildInput({ build: format2(), revision });
    expect(v2.inputHashFormat).toBe(2);
    expect(v2.toolchainId).toBe(START.id);
    const serialized = JSON.parse(
      serializeCompilerInput(v2, {
        id: v2.compilerId,
        version: v2.compilerVersion,
      }),
    );
    expect(serialized).toMatchObject({
      inputHashFormat: 2,
      framework: "tanstack-start",
      toolchainId: START.id,
    });
    // Same files, same compiler: legacy and format 2 never hash alike.
    expect(v2.inputHash).not.toBe(
      materializeThemeBuildInput({ build: build(), revision }).inputHash,
    );
  });

  it("verifies a recorded format-2 hash by format 2, and only by it", () => {
    const first = materializeThemeBuildInput({ build: format2(), revision });
    expect(
      materializeThemeBuildInput({
        build: format2({ inputHash: first.inputHash, status: "succeeded" }),
        revision,
      }).inputHash,
    ).toBe(first.inputHash);
    // The same recorded hash read as legacy does not verify.
    expect(() =>
      materializeThemeBuildInput({
        build: build({
          framework: "tanstack-start",
          inputHash: first.inputHash,
        }),
        revision,
      }),
    ).toThrow(/INPUT_HASH_MISMATCH/);
  });

  it("changes the hash when the recorded toolchain changes", () => {
    const v2 = materializeThemeBuildInput({ build: format2(), revision });
    const identity = { id: v2.compilerId, version: v2.compilerVersion };
    expect(
      computeThemeInputHash({ ...v2, toolchainId: "f".repeat(64) }, identity),
    ).not.toBe(v2.inputHash);
  });

  it("refuses an unknown format, and a legacy record that names a toolchain", () => {
    expect(() =>
      materializeThemeBuildInput({
        build: format2({ inputHashFormat: 3 }),
        revision,
      }),
    ).toThrow(/INPUT_HASH_FORMAT_UNKNOWN/);
    expect(() =>
      materializeThemeBuildInput({
        build: build({ toolchainId: START.id }),
        revision,
      }),
    ).toThrow(/INPUT_HASH_FORMAT_UNKNOWN/);
    expect(() =>
      serializeCompilerInput({ files: [], inputHashFormat: 3 as unknown as 2 }),
    ).toThrow(/INPUT_HASH_FORMAT_UNKNOWN/);
  });

  it("refuses format 2 without its framework or toolchain, never filling them in", () => {
    expect(() =>
      materializeThemeBuildInput({
        build: format2({ toolchainId: null }),
        revision,
      }),
    ).toThrow(/THEME_TOOLCHAIN_MISSING/);
    expect(() =>
      materializeThemeBuildInput({
        build: format2({ framework: null }),
        revision,
      }),
    ).toThrow(/THEME_FRAMEWORK_MISSING/);
    expect(() =>
      serializeCompilerInput({
        files: [],
        inputHashFormat: 2,
        framework: "tanstack-start",
      }),
    ).toThrow(/INPUT_HASH_FORMAT_INCOMPLETE/);
  });

  it("refuses a toolchain the registry does not have, or one for another framework", () => {
    expect(() =>
      materializeThemeBuildInput({
        build: format2({ toolchainId: "0".repeat(64) }),
        revision,
      }),
    ).toThrow(/THEME_TOOLCHAIN_UNKNOWN/);
    expect(() =>
      materializeThemeBuildInput({
        build: format2({ toolchainId: ASTRO.id }),
        revision,
      }),
    ).toThrow(/THEME_TOOLCHAIN_FRAMEWORK_MISMATCH/);
  });
});
