import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_WORKER_SCRIPT_PREFIX,
  THEME_WORKER_SCRIPT_PREFIX_MAX_LENGTH,
  THEME_WORKER_SCRIPT_PREFIX_VAR,
  WORKER_SCRIPT_NAME_MAX_LENGTH,
  resolveThemeWorkerScriptPrefix,
  themeWorkerScriptName,
  themeWorkerScriptNameForStorefront,
} from "./theme-runtime.types";

/**
 * Storefront Theme Worker script names, with and without
 * MORPH_THEME_WORKER_SCRIPT_PREFIX.
 *
 * The unset case is pinned against literal strings rather than against the
 * constant, so a change to the default itself shows up here as a failure.
 */
const DEFAULT_STOREFRONT_ID = "00000000-0000-4000-8000-000000000002";

describe("themeWorkerScriptNameForStorefront without a prefix", () => {
  it("is byte-for-byte the name production deploys today", () => {
    expect(themeWorkerScriptNameForStorefront(DEFAULT_STOREFRONT_ID)).toBe(
      "morph-theme-00000000-0000-4000-8000-000000000002",
    );
    expect(themeWorkerScriptNameForStorefront("sf_1")).toBe("morph-theme-sf-1");
    expect(themeWorkerScriptNameForStorefront("  Shop_A  ")).toBe(
      "morph-theme-shop-a",
    );
  });

  it("an environment without the variable gives the same name", () => {
    const prefix = resolveThemeWorkerScriptPrefix({});
    expect(prefix).toEqual({ ok: true, prefix: "morph-theme-" });
    expect(resolveThemeWorkerScriptPrefix(undefined)).toEqual(prefix);
    if (!prefix.ok) return;
    expect(
      themeWorkerScriptNameForStorefront(DEFAULT_STOREFRONT_ID, prefix.prefix),
    ).toBe("morph-theme-00000000-0000-4000-8000-000000000002");
  });

  it("keeps today's segment limit: 54 characters pass, 55 are refused", () => {
    // 66 characters in all: today's check, unchanged by the prefix work.
    expect(themeWorkerScriptNameForStorefront("a".repeat(54))).toBe(
      `morph-theme-${"a".repeat(54)}`,
    );
    expect(() => themeWorkerScriptNameForStorefront("a".repeat(55))).toThrow(
      /INVALID_STOREFRONT_ID/,
    );
    expect(() => themeWorkerScriptNameForStorefront("   ")).toThrow(
      /INVALID_STOREFRONT_ID/,
    );
  });

  it("leaves the per-build dispatch name alone", () => {
    expect(themeWorkerScriptName("bld_ABC123")).toBe("morph-theme-bld-abc123");
  });
});

describe("themeWorkerScriptNameForStorefront with a prefix", () => {
  const env = { [THEME_WORKER_SCRIPT_PREFIX_VAR]: "morph-stg-m1-theme-" };

  it("puts the configured prefix in front of the storefront segment", () => {
    const prefix = resolveThemeWorkerScriptPrefix(env);
    expect(prefix).toEqual({ ok: true, prefix: "morph-stg-m1-theme-" });
    if (!prefix.ok) return;
    expect(
      themeWorkerScriptNameForStorefront(DEFAULT_STOREFRONT_ID, prefix.prefix),
    ).toBe("morph-stg-m1-theme-00000000-0000-4000-8000-000000000002");
    expect(themeWorkerScriptNameForStorefront("Shop_A", prefix.prefix)).toBe(
      "morph-stg-m1-theme-shop-a",
    );
  });

  it("never names the production script for the default storefront", () => {
    const prefix = resolveThemeWorkerScriptPrefix(env);
    if (!prefix.ok) throw new Error(prefix.message);
    expect(
      themeWorkerScriptNameForStorefront(DEFAULT_STOREFRONT_ID, prefix.prefix),
    ).not.toBe(themeWorkerScriptNameForStorefront(DEFAULT_STOREFRONT_ID));
  });

  it("fits every UUID storefront under the longest accepted prefix", () => {
    const longest = `${"s".repeat(THEME_WORKER_SCRIPT_PREFIX_MAX_LENGTH - 1)}-`;
    expect(
      resolveThemeWorkerScriptPrefix({
        [THEME_WORKER_SCRIPT_PREFIX_VAR]: longest,
      }).ok,
    ).toBe(true);
    const name = themeWorkerScriptNameForStorefront(
      DEFAULT_STOREFRONT_ID,
      longest,
    );
    expect(name.length).toBe(WORKER_SCRIPT_NAME_MAX_LENGTH);
  });

  it("refuses a name over Cloudflare's 63-character limit", () => {
    expect(() =>
      themeWorkerScriptNameForStorefront("a".repeat(45), "morph-stg-m1-theme-"),
    ).toThrow(/63/);
    expect(
      themeWorkerScriptNameForStorefront("a".repeat(44), "morph-stg-m1-theme-"),
    ).toHaveLength(63);
  });

  it("refuses an invalid prefix passed directly instead of using it", () => {
    expect(() =>
      themeWorkerScriptNameForStorefront("sf_1", "Morph-Stg-"),
    ).toThrow(new RegExp(THEME_WORKER_SCRIPT_PREFIX_VAR));
  });
});

describe("resolveThemeWorkerScriptPrefix refuses invalid values", () => {
  const cases: Array<[string, unknown]> = [
    ["empty", ""],
    ["one character", "s"],
    ["too long", `${"s".repeat(THEME_WORKER_SCRIPT_PREFIX_MAX_LENGTH)}-`],
    ["uppercase", "Morph-stg-"],
    ["no trailing dash", "morph-stg"],
    ["leading dash", "-morph-stg-"],
    ["leading digit", "1morph-stg-"],
    ["underscore", "morph_stg-"],
    ["dot", "morph.stg-"],
    ["space", "morph stg-"],
    ["surrounding whitespace", " morph-stg- "],
    ["the default itself", DEFAULT_THEME_WORKER_SCRIPT_PREFIX],
    ["inside the default namespace", "morph-theme-stg-"],
    ["not a string", 42],
    ["null", null],
  ];

  for (const [label, value] of cases) {
    it(`${label}: fails closed with a message naming the variable`, () => {
      const result = resolveThemeWorkerScriptPrefix({
        [THEME_WORKER_SCRIPT_PREFIX_VAR]: value,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain(THEME_WORKER_SCRIPT_PREFIX_VAR);
      expect(result.message).toMatch(/refused/);
    });
  }
});
