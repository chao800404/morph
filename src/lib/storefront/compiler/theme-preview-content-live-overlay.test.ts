// @vitest-environment node
import { describe, expect, it } from "vitest";
import { themePreviewContentModuleSource } from "./theme-preview-content";

/**
 * The full Start Live Preview's unsaved edits, as Starter 32's client loader
 * reads them (`livePreviewContentOverlay`).
 *
 * Starter 31's client branch fetched `/_morph/content`, which this module
 * answers from the page's own snapshot, so an edit the bridge applied there
 * showed at once. Starter 32 reads through a server function, which answers
 * from the saved drafts only. The overlay lays the edits this page received
 * for one exact path over what that read returned, the same way the bridge
 * applied them to the page's snapshot; a path with no edit gets nothing.
 *
 * Taken from the module the preview really runs, evaluated whole with only
 * its imports and `window` standing in.
 */

type Content = { slots: Record<string, Record<string, unknown>>; hiddenSlots: string[] };

function previewPage(snapshot: unknown, pathname = "/") {
  let source = themePreviewContentModuleSource();
  for (const pattern of [
    /import \{[^}]*\} from "\.\/preview\/preview-protocol";\n/,
    /import initialSnapshot from "\.\/preview-content-snapshot";\n/,
  ]) {
    if (!pattern.test(source)) throw new Error(`the module no longer has ${pattern}`);
    source = source.replace(pattern, "");
  }
  source = source.replaceAll("import.meta.hot", "undefined").replace(/^export /gm, "");
  const router = { state: { location: { pathname } } };
  const window = {
    location: new URL(`http://127.0.0.1:5173${pathname}`),
    fetch: async () => new Response("network"),
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    __morphPreviewRouter: router,
  };
  const exported = new Function(
    "window",
    "initialSnapshot",
    "parseEditorToPreviewWindowEvent",
    "postPreviewToEditorMessage",
    "documentPreviewRuntimeChannel",
    `${source}\nreturn { updatePreviewContent, livePreviewContentOverlay };`,
  )(
    window,
    JSON.parse(JSON.stringify(snapshot)),
    () => null,
    () => {},
    () => null,
  ) as {
    updatePreviewContent: (
      sectionId: string,
      props?: Record<string, unknown>,
      enabled?: boolean,
      resetKeys?: string[],
    ) => boolean;
    livePreviewContentOverlay: (pathname: string, base: Content) => Content | null;
  };
  return {
    ...exported,
    /** The frame moves, as the router does on in-site navigation. */
    goTo(next: string) {
      router.state.location.pathname = next;
    },
  };
}

const SNAPSHOT = {
  templates: {
    index: { slots: { hero: { title: "Loaded" } }, hiddenSlots: [] },
    product: { slots: { card: { title: "Product loaded" } }, hiddenSlots: [] },
  },
  pages: {},
};

/** What the server function returned: the saved drafts. */
const saved = (slots: Content["slots"], hiddenSlots: string[] = []): Content => ({
  slots,
  hiddenSlots,
});

describe("Starter 32's live overlay in the full Start Live Preview", () => {
  it("has nothing for a path that received no edit", () => {
    const page = previewPage(SNAPSHOT);
    expect(page.livePreviewContentOverlay("/", saved({ hero: { title: "Saved" } }))).toBeNull();
  });

  it("lays an unsaved edit over what the read returned, and leaves that answer as it was", () => {
    const page = previewPage(SNAPSHOT);
    page.updatePreviewContent("hero", { title: "Typed, not saved" });
    const base = saved({ hero: { title: "Saved", description: "Saved text" }, other: { x: 1 } });
    const before = JSON.parse(JSON.stringify(base));
    expect(page.livePreviewContentOverlay("/", base)).toEqual({
      slots: {
        hero: { title: "Typed, not saved", description: "Saved text" },
        other: { x: 1 },
      },
      hiddenSlots: [],
    });
    expect(base).toEqual(before);
  });

  it("answers only the exact path the edit was made on, even where routes share a template", () => {
    const page = previewPage(SNAPSHOT, "/products/a");
    page.updatePreviewContent("card", { title: "Edited on a" });
    const base = saved({ card: { title: "Saved" } });
    expect(page.livePreviewContentOverlay("/products/a", base)?.slots.card).toEqual({
      title: "Edited on a",
    });
    // The same path, normalized as the store does.
    expect(page.livePreviewContentOverlay("/products/a/?x=1", base)?.slots.card).toEqual({
      title: "Edited on a",
    });
    expect(page.livePreviewContentOverlay("/products/b", base)).toBeNull();
    expect(page.livePreviewContentOverlay("/", base)).toBeNull();
  });

  it("keeps each route's edits to itself across in-site navigation", () => {
    const page = previewPage(SNAPSHOT, "/");
    page.updatePreviewContent("hero", { title: "Home edit" });
    page.goTo("/about");
    page.updatePreviewContent("about-hero", { title: "About edit" });
    expect(page.livePreviewContentOverlay("/", saved({}))?.slots).toEqual({
      hero: { title: "Home edit" },
    });
    expect(page.livePreviewContentOverlay("/about", saved({}))?.slots).toEqual({
      "about-hero": { title: "About edit" },
    });
  });

  it("keeps the newest edit over a confirmed save of an older one, and the saved fields it did not touch", () => {
    const page = previewPage(SNAPSHOT);
    page.updatePreviewContent("hero", { title: "first" });
    page.updatePreviewContent("hero", { title: "second" });
    // The save of "first" was confirmed and the page read again; "second" is
    // still unanswered. The read also brings a field saved elsewhere.
    const confirmed = saved({ hero: { title: "first", eyebrow: "saved elsewhere" } });
    expect(page.livePreviewContentOverlay("/", confirmed)?.slots.hero).toEqual({
      title: "second",
      eyebrow: "saved elsewhere",
    });
  });

  it("applies hides, shows and resets as the bridge applied them to the page", () => {
    const page = previewPage(SNAPSHOT);
    page.updatePreviewContent("promo", undefined, false);
    // A value edit for a hidden section is dropped, as on the page itself.
    page.updatePreviewContent("promo", { title: "late" });
    page.updatePreviewContent("hero", undefined, undefined, ["title"]);
    const base = saved({ promo: { title: "Saved promo" }, hero: { title: "Saved", eyebrow: "e" } });
    expect(page.livePreviewContentOverlay("/", base)).toEqual({
      slots: { hero: { eyebrow: "e" } },
      hiddenSlots: ["promo"],
    });
    page.updatePreviewContent("promo", { title: "shown again" }, true);
    expect(page.livePreviewContentOverlay("/", base)).toEqual({
      slots: { hero: { eyebrow: "e" }, promo: { title: "shown again" } },
      hiddenSlots: [],
    });
  });

  it("answers a fresh copy each time, which the caller cannot use to change what the page holds", () => {
    const page = previewPage(SNAPSHOT);
    page.updatePreviewContent("hero", { title: "Typed" });
    const first = page.livePreviewContentOverlay("/", saved({}))!;
    first.slots.hero.title = "changed by the caller";
    first.hiddenSlots.push("hero");
    expect(page.livePreviewContentOverlay("/", saved({}))).toEqual({
      slots: { hero: { title: "Typed" } },
      hiddenSlots: [],
    });
  });
});
