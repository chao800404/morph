// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { themePreviewContentModuleSource } from "./theme-preview-content";

/**
 * The client-only Live Preview answers the page's own `/_morph/content`
 * reads from the snapshot it loaded with: they never reach the network.
 *
 * Taken from the module the preview really runs
 * (`themePreviewContentModuleSource`), evaluated whole with only its two
 * imports and `window` standing in. The `window.fetch` it installs is called
 * the way Theme code calls it; the page's original fetch is a spy that must
 * not see a content read. A cross-origin request and a non-content path do
 * reach it, which shows the spy is the one the module would use.
 */

type PreviewWindow = {
  location: URL;
  fetch: (input: unknown, init?: RequestInit) => Promise<Response>;
  addEventListener: () => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

function previewFrame(snapshot: unknown) {
  let source = themePreviewContentModuleSource();
  const imports = [
    /import \{[^}]*\} from "\.\/preview\/preview-protocol";\n/,
    /import initialSnapshot from "\.\/preview-content-snapshot";\n/,
  ];
  for (const pattern of imports) {
    if (!pattern.test(source)) {
      throw new Error(`the preview content module no longer has ${pattern}`);
    }
    source = source.replace(pattern, "");
  }
  source = source
    .replaceAll("import.meta.hot", "undefined")
    .replace(/^export /gm, "");
  const network = vi.fn(async () => new Response("from the network"));
  const window: PreviewWindow = {
    location: new URL("http://127.0.0.1:5173/"),
    fetch: network,
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
  new Function(
    "window",
    "initialSnapshot",
    "parseEditorToPreviewWindowEvent",
    "postPreviewToEditorMessage",
    "documentPreviewRuntimeChannel",
    source,
  )(
    window,
    JSON.parse(JSON.stringify(snapshot)),
    () => null,
    () => {},
    () => null,
  );
  return { fetch: window.fetch, network };
}

const SNAPSHOT = {
  templates: {
    index: {
      slots: { hero: { heading: "Draft heading" } },
      hiddenSlots: ["promo"],
    },
  },
  pages: {},
};

describe("client-only Live Preview content reads", () => {
  it.each([
    ["a relative path", "/_morph/content?path=%2F"],
    ["the page's own origin", "http://127.0.0.1:5173/_morph/content?path=/"],
    [
      "a Request object",
      new Request("http://127.0.0.1:5173/_morph/content?path=/"),
    ],
  ])(
    "answers %s from the snapshot without touching the network",
    async (_label, input) => {
      const { fetch, network } = previewFrame(SNAPSHOT);
      const response = await fetch(input);
      expect(network).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        slots: { hero: { heading: "Draft heading" } },
        hiddenSlots: ["promo"],
      });
    },
  );

  it("passes every other request to the page's own fetch (control)", async () => {
    const { fetch, network } = previewFrame(SNAPSHOT);
    await fetch("/assets/app.js");
    await fetch("https://cdn.example/_morph/content?path=/");
    expect(network).toHaveBeenCalledTimes(2);
  });
});
