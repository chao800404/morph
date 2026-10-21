import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolvePageStandIn } from "./preview-dom";
import {
  acceptsPageStandIn,
  isDocumentWriteTarget,
  isPageStandInId,
} from "./page-stand-in";

/**
 * The page stand-in, at both ends.
 *
 * In the preview: a field a Theme component renders outside every section is
 * reported under the route the editor asked for, and nothing else is — not
 * plain markup, not the route's or layout's own markup, not the platform's
 * copied modules, not the editor's overlays, not a hidden section, not a node
 * of another document. In the editor: a stand-in is taken only from the
 * confirmed current document, after its route answer, for the route asked
 * for; and it is never a place content is written.
 */

afterEach(() => {
  document.body.replaceChildren();
});

beforeAll(() => {
  if (typeof CSS === "undefined") {
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
  }
});

/** The shape a full Start page with the current Starter renders. */
function mountPage() {
  document.body.innerHTML = `
    <div data-morph-source-file="src/layouts/StorefrontLayout.tsx" data-morph-loc="src/layouts/StorefrontLayout.tsx:12:5">
      <main data-morph-source-file="src/routes/explicit.tsx" data-morph-loc="src/routes/explicit.tsx:16:10">
        <h2 id="route-field" data-storefront-field="title" data-morph-loc="src/routes/explicit.tsx:17:7">Route text</h2>
        <section data-morph-source-file="src/components/Hero.tsx" data-morph-loc="src/components/Hero.tsx:10:5">
          <h1 id="title" data-storefront-field="title" data-morph-loc="src/components/Hero.tsx:11:7">Page title</h1>
          <p id="plain" data-morph-loc="src/components/Hero.tsx:12:7">Plain text</p>
        </section>
        <section data-morph-source-file="src/morph/preview/Widget.tsx">
          <span id="platform" data-storefront-field="label">Platform</span>
        </section>
        <div data-storefront-section-id="hero" data-storefront-section-type="hero">
          <section data-morph-source-file="src/components/Banner.tsx">
            <h3 id="sectioned" data-storefront-field="heading">Sectioned</h3>
          </section>
        </div>
        <div data-storefront-section-id="hidden" data-morph-section-hidden="">
          <section data-morph-source-file="src/components/Banner.tsx">
            <h3 id="hidden-field" data-storefront-field="heading">Hidden</h3>
          </section>
        </div>
      </main>
    </div>
    <div id="overlay"><span id="overlay-field" data-storefront-field="title">Ring</span></div>
    <div><button id="handle" data-storefront-editor-drag-handle="true" data-storefront-field="title">Drag</button></div>`;
  const byId = (id: string) => document.getElementById(id)!;
  const overlay = byId("overlay");
  const owns = (node: Node | null) => node !== null && overlay.contains(node);
  return { byId, owns };
}

describe("resolvePageStandIn (in the preview)", () => {
  it("names a component field outside every section for the route asked for", () => {
    const { byId, owns } = mountPage();
    const item = resolvePageStandIn(byId("title"), {
      routePath: "/explicit",
      owns,
    });
    expect(item).toMatchObject({
      sectionId: "/explicit",
      fieldKey: "title",
      fieldPath: "title",
      section: null,
    });
    expect(item?.element).toBe(byId("title"));
  });

  it("gives nothing before the editor's route is applied, or for a non-route id", () => {
    const { byId, owns } = mountPage();
    expect(
      resolvePageStandIn(byId("title"), { routePath: null, owns }),
    ).toBeNull();
    expect(
      resolvePageStandIn(byId("title"), { routePath: "hero", owns }),
    ).toBeNull();
  });

  it.each([
    ["plain markup with no field marker", "plain"],
    ["a field in the route's own markup", "route-field"],
    ["a field in the platform's copied modules", "platform"],
    ["an element inside a section, which the section answers for", "sectioned"],
    ["a field inside a hidden section", "hidden-field"],
    ["the editor's overlay", "overlay-field"],
    ["the editor's drag handle", "handle"],
  ])("gives nothing for %s", (_name, id) => {
    const { byId, owns } = mountPage();
    expect(
      resolvePageStandIn(byId(id), { routePath: "/explicit", owns }),
    ).toBeNull();
  });

  it("gives nothing for what the editor's overlays own, even placed inside a component", () => {
    // The overlays are found by identity, never by a marker a Theme could
    // copy; wherever one sits, it is the editor's and not selectable.
    const { byId } = mountPage();
    const title = byId("title");
    expect(
      resolvePageStandIn(title, {
        routePath: "/explicit",
        owns: (node) => node === title,
      }),
    ).toBeNull();
    const handle = document.createElement("button");
    handle.dataset.storefrontEditorDragHandle = "true";
    handle.dataset.storefrontField = "title";
    title.insertAdjacentElement("afterend", handle);
    expect(resolvePageStandIn(handle, { routePath: "/explicit" })).toBeNull();
  });

  it("gives nothing for a detached element or one of another document", () => {
    const { byId, owns } = mountPage();
    const title = byId("title");
    const other = document.implementation.createHTMLDocument("other");
    other.body.innerHTML = title.parentElement!.outerHTML;
    expect(
      resolvePageStandIn(other.querySelector("h1"), {
        routePath: "/explicit",
        owns,
      }),
    ).toBeNull();
    title.remove();
    expect(
      resolvePageStandIn(title, { routePath: "/explicit", owns }),
    ).toBeNull();
  });
});

describe("acceptsPageStandIn (in the editor)", () => {
  const taken = {
    sectionId: "/explicit",
    requestedRoutePath: "/explicit",
    fromConfirmedDocument: true,
    routeRequestAnswered: true,
  };

  it("takes a stand-in only when every condition holds", () => {
    expect(acceptsPageStandIn(taken)).toBe(true);
    expect(
      acceptsPageStandIn({
        ...taken,
        sectionId: "/",
        requestedRoutePath: null,
      }),
    ).toBe(true);
  });

  it.each([
    [
      "from a document not confirmed as current",
      { fromConfirmedDocument: false },
    ],
    [
      "before the frame answered the latest route request",
      { routeRequestAnswered: false },
    ],
    ["for a route other than the one asked for", { sectionId: "/other" }],
    ["for an id that is not a route path", { sectionId: "explicit" }],
  ])("refuses one %s", (_name, change) => {
    expect(acceptsPageStandIn({ ...taken, ...change })).toBe(false);
  });
});

describe("isDocumentWriteTarget", () => {
  const templateIdForSection = (sectionId: string) =>
    sectionId === "hero" || sectionId === "/explicit" ? "template-1" : null;

  it("is a section a template owns, never a page stand-in", () => {
    expect(isPageStandInId("/explicit")).toBe(true);
    expect(isPageStandInId("hero")).toBe(false);
    expect(isDocumentWriteTarget("hero", templateIdForSection)).toBe(true);
    // Even if something were to bind a route path, it is not written.
    expect(isDocumentWriteTarget("/explicit", templateIdForSection)).toBe(
      false,
    );
    expect(isDocumentWriteTarget("unbound", templateIdForSection)).toBe(false);
    expect(isDocumentWriteTarget(null, templateIdForSection)).toBe(false);
  });
});
