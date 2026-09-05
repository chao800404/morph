import { describe, expect, it } from "vitest";
import {
  extractThemeDependencyNames,
  getGeneratedThemePackageDeclarations,
  renderThemePackageTypeDeclarations,
} from "./editor-code-package-types";

describe("extractThemeDependencyNames", () => {
  it("merges runtime and development dependencies from the theme package", () => {
    expect(
      extractThemeDependencyNames([
        {
          path: "package.json",
          content: JSON.stringify({
            dependencies: {
              "@tanstack/react-router": "1.170.18",
              "lucide-react": "^0.544.0",
            },
            devDependencies: {
              vite: "7.3.5",
              "class-variance-authority": "^0.7.1",
            },
          }),
        },
      ]),
    ).toEqual([
      "@tanstack/react-router",
      "class-variance-authority",
      "lucide-react",
      "vite",
    ]);
  });

  it("returns undefined when package.json is not present and an empty list for invalid JSON", () => {
    expect(extractThemeDependencyNames([])).toBeUndefined();
    expect(
      extractThemeDependencyNames([{ path: "package.json", content: "{" }]),
    ).toEqual([]);
  });
});

describe("renderThemePackageTypeDeclarations", () => {
  it("renders supported exports while keeping unknown packages out", () => {
    const source = renderThemePackageTypeDeclarations([
      "lucide-react",
      "tailwind-merge",
      "class-variance-authority",
      "@tanstack/react-router",
      "@tanstack/react-start",
      "not-installed-in-the-theme",
    ]);

    expect(source).toContain('declare module "lucide-react"');
    expect(source).toContain("export const Sparkles:");
    expect(source).toContain(
      "export const Sparkles: (props: LucideProps) => JSX.Element;",
    );
    expect(source).toContain("export const twMerge:");
    expect(source).toContain("export const cva:");
    expect(source).toContain("export const Navigate:");
    expect(source).toContain(
      "export const Link: (props: LinkProps) => JSX.Element;",
    );
    expect(source).toContain(
      "export const createRootRoute: <TOptions extends RouteAuthoringOptions = RouteAuthoringOptions>(options?: TOptions) => ThemeRoute<RouteContextFromOptions<TOptions>>;",
    );
    expect(source).toContain("export interface Register {}");
    expect(source).toContain("export type AwaitProps = AwaitOptions &");
    expect(source).toContain("export type LucideProps = {");
    expect(source).toContain("size?: string | number;");
    expect(source).toContain("export type HydrateProps = HydrateOptions &");
    expect(source).toContain(
      "export const Hydrate: (props: HydrateProps) => JSX.Element;",
    );
    expect(source).toContain('declare module "@tanstack/react-start/server"');
    expect(source).toContain("export const getRequest: () => Request;");
    expect(source).toContain(
      "export const createIsomorphicFn: () => IsomorphicFnBase;",
    );
    expect(source).not.toContain("export type LinkOptions = unknown;");
    expect(source).not.toContain("export const LinkOptions:");
    expect(source).not.toContain("not-installed-in-the-theme");
  });

  it("expands React and React DOM package imports to their subpath modules", () => {
    const source = renderThemePackageTypeDeclarations(["react", "react-dom"]);

    expect(source).toContain('declare module "react/jsx-runtime"');
    expect(source).toContain('declare module "react-dom/client"');
    expect(source).toContain("export const useState:");
    expect(source).toContain("export const createRoot:");
    expect(source).not.toContain("declare const React");
  });

  it("keeps chained React contexts type-safe", () => {
    const source = renderThemePackageTypeDeclarations(["react"]);

    expect(source).toContain("export type Context<T> = { Provider:");
    expect(source).toContain(
      "export const createContext: <T>(defaultValue: T) => Context<T>;",
    );
    expect(source).toContain(
      "export const useContext: <T>(context: Context<T>) => T;",
    );
  });
});

describe("generated package declarations", () => {
  it("does not expose declarations unless the package is in the generated registry", () => {
    expect(getGeneratedThemePackageDeclarations(["not-approved"])).toEqual([]);
  });
});
