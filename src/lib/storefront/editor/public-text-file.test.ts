import { describe, expect, it } from "vitest";
import {
  isEditablePublicTextPath,
  projectPublicTextFile,
} from "./public-text-file";
import { prepareNewThemeFile } from "./new-theme-file";
import type { StorefrontThemeBinaryFileDTO } from "../dto/storefront-theme-file.dto";

const file: StorefrontThemeBinaryFileDTO = {
  id: "file",
  storefrontId: "store",
  themeId: "theme",
  path: "public/robots.txt",
  encoding: "binary",
  blobDigest: "a".repeat(64),
  sizeBytes: 0,
  mimeType: "text/plain; charset=utf-8",
  isEntry: false,
  version: 2,
  createdAt: "",
  updatedAt: "",
};

describe("public text editor projection", () => {
  it.each(["", "User-agent: *\r\nDisallow: /private\r\n", "\ufeff中文\n"])(
    "round-trips unchanged UTF-8 bytes: %j",
    (content) => {
      const bytes = new TextEncoder().encode(content);
      const projected = projectPublicTextFile(
        { ...file, sizeBytes: bytes.length },
        bytes,
      );
      expect(projected.content).toBe(content);
      expect(projected.version).toBe(2);
      expect(projected).not.toHaveProperty("blobDigest");
      expect(new TextEncoder().encode(projected.content)).toEqual(bytes);
    },
  );
  it("rejects malformed UTF-8 instead of replacing characters", () => {
    expect(() =>
      projectPublicTextFile({ ...file, sizeBytes: 1 }, new Uint8Array([255])),
    ).toThrow();
  });
  it("refuses binary/image projections and mismatched sizes", () => {
    expect(() =>
      projectPublicTextFile(
        { ...file, path: "public/icon.svg" },
        new Uint8Array(),
      ),
    ).toThrow();
    expect(() =>
      projectPublicTextFile({ ...file, sizeBytes: 1 }, new Uint8Array()),
    ).toThrow();
    expect(isEditablePublicTextPath("src/test.txt")).toBe(false);
  });
  it.each([
    "public/robots.txt",
    "public/sitemap.xml",
    "public/data.json",
    "public/app.webmanifest",
  ])("creates a format-appropriate seed: %s", (path) => {
    const prepared = prepareNewThemeFile(path, []);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.content).not.toContain("export default");
    if (path.endsWith(".xml")) expect(prepared.content).toContain("<root />");
    if (path.endsWith(".json") || path.endsWith(".webmanifest"))
      expect(JSON.parse(prepared.content)).toEqual({});
  });
  it.each([
    "public/_headers",
    "public/assets/data.json",
    "public/icon.svg",
    "public/page.html",
    "public/main.ts",
    "src/test.txt",
  ])("does not extend admission beyond public data text: %s", (path) => {
    expect(prepareNewThemeFile(path, []).ok).toBe(false);
  });
});
