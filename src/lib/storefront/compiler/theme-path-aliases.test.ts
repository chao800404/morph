import { describe, expect, it } from "vitest";
import {
  createThemeViteAliases,
  readThemePathAliases,
  resolveThemeBaseUrlImport,
  renderThemeViteAliases,
  resolveThemePathAlias,
} from "./theme-path-aliases";

const files = [
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@components/*": ["src/components/*"],
          "@config": ["src/config.ts"],
        },
      },
    }),
  },
  { path: "src/components/Button.tsx", content: "export default null;" },
  { path: "src/config.ts", content: "export const config = {};" },
];

describe("Theme path aliases", () => {
  it("reads TypeScript aliases and resolves wildcard and exact imports", () => {
    const config = readThemePathAliases(files);

    expect(config.diagnostics).toEqual([]);
    expect(config.baseUrl).toBe("");
    const fileMap = new Map(files.map((file) => [file.path, file] as const));
    expect(resolveThemePathAlias("@/components/Button", fileMap, config)).toBe(
      "src/components/Button.tsx",
    );
    expect(resolveThemePathAlias("@config", fileMap, config)).toBe(
      "src/config.ts",
    );
  });

  it("resolves bare imports from a configured baseUrl when no paths key matches", () => {
    const config = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
      },
      { path: "src/components/Button.tsx", content: "export default null;" },
    ]);
    const fileMap = new Map([
      ["tsconfig.json", files[0]!],
      ["src/components/Button.tsx", { path: "src/components/Button.tsx", content: "x" }],
    ] as const);

    expect(resolveThemePathAlias("components/Button", fileMap, config)).toBeNull();
    expect(resolveThemeBaseUrlImport("components/Button", fileMap, config)).toBe(
      "src/components/Button.tsx",
    );
  });

  it("creates Vite aliases rooted inside the temporary workspace", () => {
    const config = readThemePathAliases(files);
    const aliases = createThemeViteAliases(config, "/tmp/theme");
    const wildcard = aliases.find((alias) => alias.find === "@")!;
    expect(wildcard.replacement).toBe("/tmp/theme/src");
    const exact = aliases.find((alias) => alias.replacement.endsWith("config.ts"))!;
    expect(exact.find).toBeInstanceOf(RegExp);
    expect((exact.find as RegExp).test("@config")).toBe(true);
    expect((exact.find as RegExp).test("@config/extra")).toBe(false);
    expect(renderThemeViteAliases(config, "/workspace")).toContain(
      '"key":"@"',
    );
  });

  it("accepts the comments and trailing commas used by normal tsconfig JSONC", () => {
    const config = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: `{
          // Theme aliases
          "compilerOptions": {
            "paths": {
              "@/*": ["src/*"],
            },
          },
        }`,
      },
    ]);

    expect(config.diagnostics).toEqual([]);
    expect(config.aliases).toEqual([
      { key: "@", target: "src", wildcard: true },
    ]);
  });

  it("fails closed for invalid or escaping alias configuration", () => {
    const config = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            baseUrl: "../../outside",
            paths: { "@/*": ["../../outside/*"] },
          },
        }),
      },
    ]);

    expect(config.diagnostics.length).toBeGreaterThan(0);
    expect(config.aliases).toEqual([]);
  });

  it("resolves a relative extends chain and applies child compiler options", () => {
    const config = readThemePathAliases([
      {
        path: "configs/base.json",
        content: `{
          "compilerOptions": {
            "baseUrl": "src",
            "paths": {
              "@/*": ["*"],
              "@shared/*": ["shared/*"]
            }
          }
        }`,
      },
      {
        path: "tsconfig.json",
        content: `{
          "extends": "./configs/base",
          "compilerOptions": {
            "paths": {
              "@/*": ["app/*"]
            }
          }
        }`,
      },
      { path: "src/app/Button.tsx", content: "export default null;" },
      { path: "src/shared/format.ts", content: "export const format = () => '';" },
    ]);

    expect(config.diagnostics).toEqual([]);
    expect(config.baseUrl).toBe("configs/src");
    expect(config.paths).toEqual({ "@/*": ["app/*"] });
    expect(config.aliases).toEqual([
      { key: "@", target: "app", wildcard: true },
    ]);

    const fileMap = new Map([
      ["src/app/Button.tsx", { path: "src/app/Button.tsx", content: "x" }],
      ["configs/src/app/Button.tsx", { path: "configs/src/app/Button.tsx", content: "x" }],
    ] as const);
    expect(resolveThemePathAlias("@/Button", fileMap, config)).toBe(
      "configs/src/app/Button.tsx",
    );
  });

  it("rejects package, missing, and cyclic extends without reading outside the workspace", () => {
    const packageConfig = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: JSON.stringify({ extends: "@company/tsconfig" }),
      },
    ]);
    expect(packageConfig.diagnostics[0]?.message).toContain(
      "must resolve to an existing relative config",
    );

    const missingConfig = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: JSON.stringify({ extends: "./configs/base" }),
      },
    ]);
    expect(missingConfig.diagnostics[0]?.message).toContain(
      "must resolve to an existing relative config",
    );

    const cyclicConfig = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: JSON.stringify({ extends: "./base" }),
      },
      {
        path: "base.json",
        content: JSON.stringify({ extends: "./tsconfig.json" }),
      },
    ]);
    expect(cyclicConfig.diagnostics.some((item) => item.message.includes("cycle"))).toBe(true);
  });

  it("preserves a safe parent traversal in a path target when the joined path stays in the workspace", () => {
    const config = readThemePathAliases([
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            baseUrl: "src",
            paths: { "@shared/*": ["../shared/*"] },
          },
        }),
      },
      { path: "shared/value.ts", content: "export const value = 1;" },
    ]);
    expect(config.diagnostics).toEqual([]);
    expect(config.aliases).toEqual([
      { key: "@shared", target: "../shared", wildcard: true },
    ]);
    const fileMap = new Map([
      ["shared/value.ts", { path: "shared/value.ts", content: "x" }],
    ] as const);
    expect(resolveThemePathAlias("@shared/value", fileMap, config)).toBe(
      "shared/value.ts",
    );
  });
});
