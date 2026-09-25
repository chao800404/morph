// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  checkThemePublicFiles,
  checkThemePublicPath,
  describeThemePublicProblem,
  themePublicBytesMatch,
  themePublicUrlPath,
  THEME_PUBLIC_LIMITS,
  type ThemePublicSetProblem,
} from "./theme-public-files";
import {
  saveThemeFileInputSchema,
  saveThemeFilesBatchInputSchema,
} from "@/lib/validations/storefront-theme-file";

const ROUTES = ["/", "/about", "/products", "/products/$slug", "/$lang"];
const reason = (path: string) => {
  const check = checkThemePublicPath(path, ROUTES);
  return check.ok ? null : check.reason;
};

describe("checkThemePublicPath", () => {
  it("serves an image under public/ at the path below it", () => {
    expect(checkThemePublicPath("public/images/hero.png", ROUTES)).toEqual({
      ok: true,
      urlPath: "/images/hero.png",
      mimeType: "image/png",
    });
    expect(themePublicUrlPath("public/favicon.ico")).toBe("/favicon.ico");
    expect(themePublicUrlPath("src/public/x.png")).toBeNull();
  });

  it("names each supported format's type, whatever the extension's case", () => {
    expect(checkThemePublicPath("public/a.JPG")).toMatchObject({
      mimeType: "image/jpeg",
    });
    expect(checkThemePublicPath("public/fonts/body.woff2")).toMatchObject({
      mimeType: "font/woff2",
    });
    expect(checkThemePublicPath("public/a.avif")).toMatchObject({
      mimeType: "image/avif",
    });
  });

  it("refuses SVG, and anything that is not an image or a font", () => {
    expect(reason("public/logo.svg")).toBe("svg-not-allowed");
    expect(reason("public/logo.SVGZ")).toBe("svg-not-allowed");
    expect(reason("public/robots.txt")).toBe("unsupported-format");
    expect(reason("public/page.html")).toBe("unsupported-format");
    expect(reason("public/noextension")).toBe("unsupported-format");
  });

  it("refuses files the host treats as instructions, not content", () => {
    for (const path of [
      "public/_headers",
      "public/_redirects",
      "public/_routes.json",
      "public/_worker.js",
      "public/index.html",
      "public/Index.HTML",
      "public/docs/404.html",
    ]) {
      expect(reason(path), path).toBe("platform-file");
    }
  });

  it("refuses URLs the platform answers itself, in any case", () => {
    expect(reason("public/_morph/content.png")).toBe("reserved-prefix");
    expect(reason("public/assets/logo.png")).toBe("reserved-prefix");
    expect(reason("public/Assets/logo.png")).toBe("reserved-prefix");
    expect(reason("public/_serverFn/x.png")).toBe("reserved-prefix");
    expect(reason("public/cdn-cgi/x.png")).toBe("reserved-prefix");
    // A folder merely starting with the same letters is its own URL.
    expect(reason("public/assets-2/logo.png")).toBeNull();
  });

  it("refuses a file that would take a static route's URL", () => {
    expect(checkThemePublicPath("public/about", ["/about"])).toEqual({
      ok: false,
      reason: "route-collision",
    });
    expect(
      checkThemePublicPath("public/Sitemap.png", ["/sitemap.png"]),
    ).toEqual({ ok: false, reason: "route-collision" });
    // One URL a dynamic route could also answer is Vite's behaviour.
    expect(reason("public/favicon.ico")).toBeNull();
    expect(reason("public/products/shirt.png")).toBeNull();
  });

  it("refuses hidden files and unsafe paths", () => {
    expect(reason("public/.well-known/x.png")).toBe("hidden-file");
    expect(reason("public/images/.x.png")).toBe("hidden-file");
    expect(reason("public/../src/x.png")).toBe("unsafe-path");
    expect(reason("public/a%2Fb.png")).toBe("unsafe-path");
    expect(reason("public/a b.png")).toBe("unsafe-path");
    expect(reason("public/")).toBe("not-public");
    expect(reason("images/x.png")).toBe("not-public");
  });
});

describe("themePublicBytesMatch", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const text = (value: string) => new TextEncoder().encode(value);
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);

  it("accepts bytes that are the format the path names", () => {
    expect(themePublicBytesMatch("public/a.png", PNG)).toBe(true);
    expect(
      themePublicBytesMatch("public/a.jpg", bytes(0xff, 0xd8, 0xff, 0xe0)),
    ).toBe(true);
    expect(themePublicBytesMatch("public/a.gif", text("GIF89a..."))).toBe(true);
    expect(
      themePublicBytesMatch("public/a.webp", text("RIFF\0\0\0\0WEBPVP8 ")),
    ).toBe(true);
    expect(
      themePublicBytesMatch("public/a.avif", text("\0\0\0\x1cftypavif")),
    ).toBe(true);
    expect(themePublicBytesMatch("public/a.woff2", text("wOF2...."))).toBe(
      true,
    );
  });

  it("refuses bytes that are something else under an image's name", () => {
    expect(themePublicBytesMatch("public/a.jpg", PNG)).toBe(false);
    expect(themePublicBytesMatch("public/a.png", text("<svg onload=x>"))).toBe(
      false,
    );
    expect(themePublicBytesMatch("public/a.png", new Uint8Array())).toBe(false);
    expect(themePublicBytesMatch("public/a.svg", text("<svg/>"))).toBe(false);
  });
});

describe("checkThemePublicFiles", () => {
  const MB = 1024 * 1024;

  it("accepts a set within every limit", () => {
    expect(
      checkThemePublicFiles([
        { path: "public/a.png", size: MB },
        { path: "public/b.png", size: 2 * MB },
      ]),
    ).toEqual({ ok: true, totalBytes: 3 * MB });
  });

  it("names every file and every limit it breaks", () => {
    const result = checkThemePublicFiles(
      [
        { path: "public/big.png", size: THEME_PUBLIC_LIMITS.maxFileBytes + 1 },
        { path: "public/Logo.png", size: 10 },
        { path: "public/logo.png", size: 10 },
        { path: "public/logo.svg", size: 10 },
      ],
      [],
    );
    expect(result).toEqual({
      ok: false,
      problems: [
        { path: "public/big.png", reason: "file-too-large" },
        { path: "public/logo.png", reason: "case-collision" },
        { path: "public/logo.svg", reason: "svg-not-allowed" },
      ],
    });
  });

  it("counts the files and the total of the whole directory", () => {
    const many = Array.from(
      { length: THEME_PUBLIC_LIMITS.maxFiles + 1 },
      (_, i) => ({
        path: `public/i${i}.png`,
        size: 1,
      }),
    );
    expect(checkThemePublicFiles(many)).toMatchObject({
      ok: false,
      problems: [{ path: "public/", reason: "too-many-files" }],
    });
    const heavy = Array.from({ length: 11 }, (_, i) => ({
      path: `public/h${i}.png`,
      size: 5 * MB,
    }));
    expect(checkThemePublicFiles(heavy)).toMatchObject({
      ok: false,
      problems: [{ path: "public/", reason: "total-too-large" }],
    });
  });

  it("has a sentence for every problem", () => {
    const reasons: ThemePublicSetProblem["reason"][] = [
      "not-public",
      "unsafe-path",
      "hidden-file",
      "platform-file",
      "reserved-prefix",
      "route-collision",
      "svg-not-allowed",
      "unsupported-format",
      "file-too-large",
      "case-collision",
      "too-many-files",
      "total-too-large",
    ];
    for (const item of reasons) {
      expect(describeThemePublicProblem(item).length).toBeGreaterThan(10);
    }
  });
});

describe("writing source as text", () => {
  const base = {
    storefrontId: "s",
    themeId: "t",
    content: "x",
    expectMissing: true,
    expectedSourceGeneration: 1,
  };

  it("refuses public/, which holds uploaded files", () => {
    expect(
      saveThemeFileInputSchema.safeParse({ ...base, path: "public/robots.txt" })
        .success,
    ).toBe(false);
    expect(
      saveThemeFilesBatchInputSchema.safeParse({
        storefrontId: "s",
        themeId: "t",
        expectedSourceGeneration: 1,
        files: [{ path: "public/a.png", content: "x", expectMissing: true }],
      }).success,
    ).toBe(false);
  });

  it("still writes source anywhere else, and still removes from public/", () => {
    expect(
      saveThemeFileInputSchema.safeParse({ ...base, path: "src/public/x.ts" })
        .success,
    ).toBe(true);
    expect(
      saveThemeFilesBatchInputSchema.safeParse({
        storefrontId: "s",
        themeId: "t",
        expectedSourceGeneration: 1,
        files: [],
        deletions: [
          {
            path: "public/robots.txt",
            expectedFileId: "00000000-0000-4000-8000-000000000001",
            expectedVersion: 1,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
