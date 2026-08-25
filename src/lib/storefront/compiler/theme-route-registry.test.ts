import { describe, expect, it } from "vitest";
import {
  buildThemeRouteRegistry,
  isThemeRouteSourcePath,
} from "./theme-route-registry";

describe("Theme route registry", () => {
  it("discovers static and dynamic TanStack routes without executing source", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content:
          'import { createRootRoute } from "@tanstack/react-router"; export const Route = createRootRoute({});',
      },
      {
        path: "src/routes/index.tsx",
        content:
          'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/")({ component: Home });',
      },
      {
        path: "src/routes/pages/$handle.tsx",
        content:
          'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/pages/$handle")({ component: Page });',
      },
    ]);

    expect(registry.diagnostics).toEqual([]);
    expect(registry.routes).toEqual([
      expect.objectContaining({
        kind: "root",
        sourcePath: "src/routes/__root.tsx",
      }),
      expect.objectContaining({
        path: "/",
        dynamic: false,
        componentName: "Home",
      }),
      expect.objectContaining({
        path: "/pages/$handle",
        dynamic: true,
        componentName: "Page",
      }),
    ]);
  });

  it("fails closed for dynamic expressions, duplicate paths, and missing root", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/about.tsx",
        content: 'export const Route = createFileRoute("/about")({});',
      },
      {
        path: "src/routes/company.tsx",
        content: 'export const Route = createFileRoute("/about")({});',
      },
      {
        path: "src/routes/dynamic.tsx",
        content: "export const Route = createFileRoute(routePath)({});",
      },
    ]);

    expect(registry.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ROUTE_PATH",
        "INVALID_ROUTE_PATH",
        "MISSING_ROOT_ROUTE",
      ]),
    );
  });

  it("ignores route-internal and generated companion modules", () => {
    expect(isThemeRouteSourcePath("src/routes/-components/card.tsx")).toBe(
      false,
    );
    expect(isThemeRouteSourcePath("src/routes/about.lazy.tsx")).toBe(false);
    expect(isThemeRouteSourcePath("src/routes/about.tsx")).toBe(true);
    expect(isThemeRouteSourcePath("src/pages/about.tsx")).toBe(false);
  });

  it("fails closed when a route-directory source does not declare a route", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/about.tsx",
        content: "export default function About() { return null; }",
      },
    ]);

    expect(registry.valid).toBe(false);
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({ code: "UNDECLARED_ROUTE_MODULE" }),
    ]);
  });
});
