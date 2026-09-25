import { describe, expect, it } from "vitest";
import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
} from "../dto/storefront-theme-file.dto";
import { buildFileTree } from "./storefront-theme-file.dal";

const common = {
  storefrontId: "store-1",
  themeId: "theme-1",
  isEntry: false,
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const source: StorefrontThemeFileDTO = {
  ...common,
  id: "file-1",
  path: "src/routes/index.tsx",
  content: "export default 1;",
  mimeType: "text/typescript",
};

const image: StorefrontThemeBinaryFileDTO = {
  ...common,
  id: "binary-1",
  path: "public/images/hero.png",
  encoding: "binary",
  blobDigest: "d".repeat(64),
  sizeBytes: 2048,
  mimeType: "image/png",
};

describe("buildFileTree", () => {
  it("places a binary file beside source, sized by its bytes and marked as binary", () => {
    const tree = buildFileTree([image, source]);

    expect(tree.map((node) => node.path)).toEqual(["public", "src"]);
    const hero = tree[0]!.children![0]!.children![0]!;
    expect(hero).toEqual({
      name: "hero.png",
      path: "public/images/hero.png",
      isDirectory: false,
      mimeType: "image/png",
      size: 2048,
      encoding: "binary",
    });
    const index = tree[1]!.children![0]!.children![0]!;
    expect(index.encoding).toBeUndefined();
    expect(index.size).toBe(source.content.length);
  });
});
