import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * A page row's navigation, as the shell asks for it.
 *
 * A click used to navigate twice: once from the click, and again from the
 * effect that follows a pending route, which saw the URL still on the old page
 * while the router was loading the new one and asked for it again — and a
 * second navigation to the same location restarts the first one's load. Home
 * was worse: it is `"/"` when asked for and absent from the URL once there, so
 * the pending switch never matched, never cleared, and asked again on every
 * later change.
 *
 * The harness plays the router: `onSearchChange` moves the location it is
 * heading to at once, as `navigate` does, while `search` moves only when a
 * test says the load finished.
 */

vi.mock("./editor-assistant-panel", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The real panel sends jsdom through React's nested-update limit; see
  // visual-editor-shell-round-trip.test.tsx. The rows clicked here are in the
  // sections panel.
  EditorAssistantPanel: () => null,
}));

vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const context = {
  previewChannel: {
    editorOrigin: "http://localhost:3000",
    sessionId: "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e",
  },
  storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const baseSearch = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

const routeFile = (path: string, route: string) => ({
  id: `file-${route}`,
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path,
  content: `import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("${route}")({ component: () => <main /> });\n`,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
});

function queryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: "https://preview.morph.test/store/1/themes/1/preview" },
    } as never,
  );
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files: [
        routeFile("src/routes/index.tsx", "/"),
        routeFile("src/routes/products.tsx", "/products"),
      ],
      tree: [
        {
          name: "src",
          path: "src",
          isDirectory: true,
          children: [
            {
              name: "routes",
              path: "src/routes",
              isDirectory: true,
              children: [
                { name: "index.tsx", path: "src/routes/index.tsx", isDirectory: false },
                { name: "products.tsx", path: "src/routes/products.tsx", isDirectory: false },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return client;
}

type Harness = {
  asked: Array<Partial<StorefrontThemeEditorSearch>>;
  /** The load for the location being navigated to finished. */
  finishLoad: () => void;
  /** The navigation did not happen: the router is back where it was. */
  abandon: () => void;
  /** An unrelated change, to give effects a reason to run again. */
  touch: () => void;
};

function renderRouted(initialRoutePath: string | undefined) {
  const harness = {} as Harness;
  harness.asked = [];
  const client = queryClient();

  function Routed() {
    const [search, setSearch] = useState<StorefrontThemeEditorSearch>({
      ...baseSearch,
      ...(initialRoutePath ? { routePath: initialRoutePath } : {}),
    });
    const [heading, setHeading] = useState<StorefrontThemeEditorSearch>(search);
    const [, setTick] = useState(0);
    harness.finishLoad = () => act(() => setSearch(heading));
    harness.abandon = () => act(() => setHeading(search));
    harness.touch = () => act(() => setTick((tick) => tick + 1));
    const onSearchChange = (next: Partial<StorefrontThemeEditorSearch>) => {
      harness.asked.push(next);
      // As `navigate` does: the router is heading there before it has loaded.
      // Like the route's search middleware, a Home location carries no path.
      setHeading((previous) => {
        const merged = { ...previous, ...next };
        if (merged.routePath === "/") delete merged.routePath;
        return merged;
      });
    };
    return (
      <VisualEditorShell
        context={context}
        search={search}
        onSearchChange={onSearchChange}
        navigatingRoutePath={heading.routePath || "/"}
      />
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Routed />
    </QueryClientProvider>,
  );
  return harness;
}

const routePathsAsked = (harness: Harness) =>
  harness.asked.filter((next) => "routePath" in next).map((next) => next.routePath);

async function clickPage(label: string) {
  const row = await screen.findByTitle(`Preview ${label}`);
  act(() => row.click());
}

describe("switching pages from the sidebar", () => {
  it("asks for the page once while its navigation is in flight", async () => {
    const harness = renderRouted(undefined);
    await clickPage("/products");
    harness.touch();
    harness.touch();
    expect(routePathsAsked(harness)).toEqual(["/products"]);
    harness.finishLoad();
    harness.touch();
    expect(routePathsAsked(harness)).toEqual(["/products"]);
  });

  it("asks again when the navigation did not happen", async () => {
    const harness = renderRouted(undefined);
    await clickPage("/products");
    expect(routePathsAsked(harness)).toEqual(["/products"]);
    harness.abandon();
    // Not blocked by having asked before: the router is not going there.
    expect(routePathsAsked(harness)).toEqual(["/products", "/products"]);
  });

  it("settles on Home, which the URL spells without a path", async () => {
    const harness = renderRouted("/products");
    await clickPage("/");
    expect(routePathsAsked(harness)).toEqual(["/"]);
    harness.finishLoad();
    harness.touch();
    harness.touch();
    expect(routePathsAsked(harness)).toEqual(["/"]);
  });
});
