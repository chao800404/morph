import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentPreviewIdentity } from "@/lib/storefront/editor/preview-protocol";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";

/**
 * Morph's own preview route answers the ping the editor confirms a ready
 * with (C5 option A) from the moment it says it is ready.
 *
 * The route posts ready from its selection-bridge effect
 * (`useStorefrontPreviewSelectionBridge`), and answers pings from the theme
 * files effect of the child it renders once its query has data
 * (`usePreviewThemeFiles` in `ReadyStorefrontPreview`). A child's effects run
 * before its parent's, so the listener must already be there when ready goes
 * out. Here the editor's ping is delivered the instant the ready is posted,
 * and the answer has to come back, carrying the same document id as the
 * ready.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const PROBE = 2 ** 40 + 1;

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createFileRoute:
    () =>
    (options: Record<string, unknown>) => ({
      ...options,
      useParams: () => ({ storefrontId: "storefront-1", themeId: "theme-1" }),
      useSearch: () => ({ templateId: "template-1", viewportHeight: 900 }),
    }),
}));
// The page itself is not what this test is about.
vi.mock("@/components/storefront/storefront-preview", () => ({
  StorefrontPreview: () => null,
}));

let editor: Window;
let posted: Array<Record<string, unknown>>;

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    `/preview?editorOrigin=${encodeURIComponent(EDITOR_ORIGIN)}&previewSession=${PREVIEW_SESSION}`,
  );
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  editor = frame.contentWindow!;
  posted = [];
  vi.spyOn(editor, "postMessage").mockImplementation(((message: Record<string, unknown>) => {
    posted.push(message);
    // The editor's confirmation ping, delivered the moment ready is posted.
    if (message.type === "morph:storefront-preview-ready") {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-ping",
            heartbeatId: PROBE,
            previewSession: PREVIEW_SESSION,
          },
          origin: EDITOR_ORIGIN,
          source: editor,
        }),
      );
    }
  }) as never);
  Object.defineProperty(window, "parent", { value: editor, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, "parent", { value: window, configurable: true });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Morph's preview route and the ping a ready is confirmed with", () => {
  it("answers a ping that arrives as it says ready, with the same document id", async () => {
    const { Route } = await import("../store/$storefrontId/themes/$themeId/preview");
    const Component = (Route as unknown as { component: () => React.ReactNode }).component;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey, {
      success: true,
      message: "ok",
      data: {
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
      },
    } as never);
    client.setQueryData(storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey, {
      files: [],
      tree: [],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never);
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Component />
        </QueryClientProvider>,
      );
    });
    const ready = posted.find((message) => message.type === "morph:storefront-preview-ready");
    const pong = posted.find((message) => message.type === "morph:storefront-preview-pong");
    // Precondition: the route said it is ready.
    expect(ready).toBeDefined();
    expect(pong).toMatchObject({
      type: "morph:storefront-preview-pong",
      heartbeatId: PROBE,
      previewSession: PREVIEW_SESSION,
      previewDocument: documentPreviewIdentity(),
    });
    expect(ready?.previewDocument).toBe(pong?.previewDocument);
    // Answered after the ready, not before: the order the editor relies on.
    expect(posted.indexOf(pong!)).toBeGreaterThan(posted.indexOf(ready!));
  });
});
