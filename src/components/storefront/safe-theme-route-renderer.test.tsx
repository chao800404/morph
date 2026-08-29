// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeRoute } from "./safe-theme-route-renderer";

const files = [
  {
    path: "src/routes/__root.tsx",
    content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: RootRoute });
export function RootRoute() {
  return <div><Outlet /></div>;
}`,
  },
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><Hero /></main>;
}`,
  },
  {
    path: "src/components/Hero.tsx",
    content: `import { Link } from "@tanstack/react-router";
export default function Hero() {
  return <Link to="/collections/$handle" params={{ handle: "all" }} search={{ sort: "new" }} hash="featured" preload="intent">Shop all</Link>;
}`,
  },
];

describe("TanStack Router builtins in the safe Theme preview", () => {
  it("renders Link as a safe anchor with resolved navigation props", () => {
    const result = renderSafeThemeRoute({
      files,
      pathname: "/",
      document: { version: 1, sections: [] } as never,
    });

    expect(
      result.success,
      result.success ? "" : result.diagnostics.join(),
    ).toBe(true);
    if (!result.success) return;

    const html = renderToStaticMarkup(result.node as never);
    expect(html).toContain('href="/collections/all?sort=new#featured"');
    expect(html).toContain(">Shop all</a>");
    expect(html).not.toContain('preload="intent"');
    expect(html).not.toContain('to="/collections/$handle"');
  });

  it("does not emit dangerous Router destinations", () => {
    const dangerousFiles = files.map((file) =>
      file.path === "src/routes/index.tsx"
        ? {
            ...file,
            content: file.content.replace(
              'to="/collections/$handle"',
              'to="javascript:alert(1)"',
            ),
          }
        : file,
    );
    const result = renderSafeThemeRoute({
      files: dangerousFiles,
      pathname: "/",
      document: { version: 1, sections: [] } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(renderToStaticMarkup(result.node as never)).not.toContain(
      "javascript:",
    );
  });
});
