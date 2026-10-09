import { describe, expect, it } from "vitest";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "@/lib/storefront/starter-theme-v3-files";
import { confirmThemeContentModuleFunctionExport } from "./theme-content-module";

const PATH = "src/morph/content.ts";
const check = (content: string | null, name = "content") =>
  confirmThemeContentModuleFunctionExport(
    content === null ? [] : [{ path: PATH, content }],
    name,
    "add a section",
  );

describe("confirmThemeContentModuleFunctionExport", () => {
  // If a Starter ever produces `content` some other way, this fails first, so
  // a narrow, provable rule for it has to be written instead of a name match.
  it.each([
    ["the original Starter", LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE],
    ["Starter v12", LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE],
    ["Starter v13", LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE],
    ["Starter v14", LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE],
    ["the current Starter", STARTER_THEME_CONTENT_MODULE_SOURCE],
  ])("confirms content() in %s", (_, source) => {
    expect(check(source)).toEqual({ ok: true });
  });

  it("confirms the current Starter's other function exports, but not morph", () => {
    expect(check(STARTER_THEME_CONTENT_MODULE_SOURCE, "isSectionHidden")).toEqual({ ok: true });
    // `morph` is an object of functions: not itself callable.
    expect(check(STARTER_THEME_CONTENT_MODULE_SOURCE, "morph")).toMatchObject({
      ok: false,
      reason: "not-callable",
    });
  });

  it.each([
    ["a function declaration", "export function content() { return {}; }"],
    ["an overloaded declaration", "export function content(slot: string): object;\nexport function content(slot: string) { return {}; }"],
    ["an arrow const", "export const content = (slot: string) => ({});"],
    ["a function-expression const", "export const content = function (slot: string) { return {}; };"],
    ["a type-annotated const", "export const content: (slot: string) => Record<string, unknown> = (slot) => ({});"],
    ["an `as` wrapper", "export const content = ((slot: string) => ({})) as (slot: string) => object;"],
    ["a `satisfies` wrapper", "type Reader = (slot: string) => object;\nexport const content = ((slot) => ({})) satisfies Reader;"],
    ["a non-null wrapper", "export const content = ((slot: string) => ({}))!;"],
    ["nested wrappers", "export const content = (((slot: string) => ({})) satisfies Function) as unknown as (s: string) => object;"],
    ["a local export list", "function read() { return {}; }\nexport { read as content };"],
    ["a local alias chain", "const read = (s: string) => ({});\nconst alias = read;\nexport { alias as content };"],
  ])("confirms %s", (_, source) => {
    expect(check(source)).toEqual({ ok: true });
  });

  it.each([
    ["a number", "export const content = 123;"],
    ["a string", 'export const content = "hero";'],
    ["a template literal", "export const content = `hero`;"],
    ["an object", "export const content = { hero: {} };"],
    ["an array", "export const content = [];"],
    ["null", "export const content = null;"],
    ["undefined", "export const content = undefined;"],
    ["a class", "export class content {}"],
    ["a wrapped number", "export const content = 123 as unknown as () => object;"],
    ["a local class in an export list", "class Reader {}\nexport { Reader as content };"],
  ])("refuses %s as not callable", (_, source) => {
    expect(check(source)).toMatchObject({ ok: false, reason: "not-callable" });
  });

  it.each([
    ["a factory result", 'import { make } from "./make";\nexport const content = make();'],
    ["a named re-export", 'export { content } from "./my-content";'],
    ["an imported binding", 'import { read } from "./read";\nexport { read as content };'],
    ["a destructured export", "export const { content } = makeAll();"],
    ["a declaration without a value", "export let content;"],
    ["export *", 'export * from "./elsewhere";'],
  ])("does not confirm %s, and says so", (_, source) => {
    const result = check(source);
    expect(result).toMatchObject({ ok: false, reason: "unconfirmed" });
    if (!result.ok) {
      expect(result.message).toContain("cannot confirm");
      expect(result.message).toContain("Saving and building are not affected");
    }
  });

  it("confirms a declared function even next to export *", () => {
    expect(
      check('export * from "./elsewhere";\nexport function content() {}'),
    ).toEqual({ ok: true });
  });

  it("names the restore command when the module is missing", () => {
    const result = check(null);
    expect(result).toMatchObject({ ok: false, reason: "missing" });
    if (!result.ok) {
      expect(result.message).toContain("Theme: Restore Starter Content Module");
      expect(result.message).toContain("Cannot add a section");
    }
  });

  it("asks only for the export the operation needs", () => {
    // A module that serves `morph.pages.get` routes is complete for them.
    const pagesOnly = "export const morph = { pages: { get() {} } };";
    expect(check(pagesOnly, "content")).toMatchObject({
      ok: false,
      reason: "not-exported",
    });
  });

  it.each([
    ["a type alias", "export type content = () => void;"],
    ["a type-only export list", "type C = () => void;\nexport type { C as content };"],
    ["an inline type specifier", "type C = () => void;\nexport { type C as content };"],
    ["an ambient declaration", "export declare function content(): void;"],
    ["a default export", "export default function content() {}"],
  ])("does not count %s as the runtime export", (_, source) => {
    expect(check(source)).toMatchObject({ ok: false, reason: "not-exported" });
  });

  it("reports a module that does not parse instead of guessing", () => {
    expect(check("export function content( {")).toMatchObject({
      ok: false,
      reason: "unparseable",
    });
  });

  it("only parses the module, never runs it", () => {
    const source =
      'globalThis.__contentModuleRan = true;\nthrow new Error("ran");\nexport function content() {}';
    expect(check(source)).toEqual({ ok: true });
    expect((globalThis as Record<string, unknown>).__contentModuleRan).toBe(
      undefined,
    );
  });
});
