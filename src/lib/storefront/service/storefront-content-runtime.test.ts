import { describe, expect, it, vi } from "vitest";
import {
  pageHandleForPath,
  resolveStorefrontContent,
  templateTypeForPath,
} from "./storefront-content-runtime";

describe("templateTypeForPath", () => {
  it("maps the paths a published document can describe", () => {
    expect(templateTypeForPath("/")).toBe("index");
    expect(templateTypeForPath("")).toBe("index");
    expect(templateTypeForPath("/products/mug")).toBe("product");
    expect(templateTypeForPath("/collections/new")).toBe("collection");
    expect(templateTypeForPath("/pages/about")).toBe("page");
    expect(templateTypeForPath("/blogs/journal")).toBe("blog");
  });

  it("ignores a query string and a trailing slash", () => {
    expect(templateTypeForPath("/?utm=x")).toBe("index");
    expect(templateTypeForPath("/products/mug/")).toBe("product");
  });

  it("returns null for a route no document describes", () => {
    // A code-authored route legitimately has no Document; that is not an error.
    expect(templateTypeForPath("/about")).toBeNull();
    expect(templateTypeForPath("/anything/else")).toBeNull();
  });
});

describe("resolveStorefrontContent", () => {
  const document = {
    sections: [
      { id: "starter-hero", enabled: true, props: { heading: "Published" } },
      { id: "starter-promo", enabled: false, props: { heading: "Hidden" } },
      { id: "has space", enabled: true, props: { heading: "Invalid" } },
      { id: "starter-empty", enabled: true, props: null },
    ],
  };

  const ports = (doc: unknown = document) => ({
    getPublishedDocument: vi.fn(async () => doc as never),
  });

  it("returns each enabled section's props keyed by slot", async () => {
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/",
      ports: ports(),
    });

    expect(result.slots["starter-hero"]).toEqual({ heading: "Published" });
    expect(result.slots["starter-empty"]).toEqual({});
  });

  it("omits a disabled section so hiding one needs no Theme change", async () => {
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/",
      ports: ports(),
    });
    expect(result.slots["starter-promo"]).toBeUndefined();
  });

  it("omits a section whose id could not be a slot", async () => {
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/",
      ports: ports(),
    });
    expect(result.slots["has space"]).toBeUndefined();
  });

  it("reads only the publication the active release points at", async () => {
    const p = ports();
    await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/",
      ports: p,
    });
    expect(p.getPublishedDocument).toHaveBeenCalledWith({
      publicationId: "pub_1",
      templateType: "index",
    });
  });

  it("returns nothing when the release publishes no content", async () => {
    const p = ports();
    const result = await resolveStorefrontContent({
      publicationId: null,
      pathname: "/",
      ports: p,
    });
    expect(result.slots).toEqual({});
    expect(p.getPublishedDocument).not.toHaveBeenCalled();
  });

  it("returns nothing for a route no document describes", async () => {
    const p = ports();
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/about",
      ports: p,
    });
    expect(result.slots).toEqual({});
    expect(p.getPublishedDocument).not.toHaveBeenCalled();
  });

  it("tolerates a missing or malformed document", async () => {
    expect(
      (
        await resolveStorefrontContent({
          publicationId: "pub_1",
          pathname: "/",
          ports: ports(null),
        })
      ).slots,
    ).toEqual({});

    expect(
      (
        await resolveStorefrontContent({
          publicationId: "pub_1",
          pathname: "/",
          ports: ports({}),
        })
      ).slots,
    ).toEqual({});
  });
});

describe("hidden sections (RUNTIME-01)", () => {
  const ports = (sections: unknown[]) => ({
    getPublishedDocument: vi.fn(async () => ({ sections }) as never),
  });

  // Omitting a hidden section made it indistinguishable from a route with no
  // Document, and the theme renders that with the component's own defaults —
  // so hiding a section published the starter copy instead of removing it.
  it("names hidden sections instead of dropping them", async () => {
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/",
      ports: ports([
        { id: "starter-hero", enabled: true, props: { heading: "Shown" } },
        { id: "starter-promo", enabled: false, props: { heading: "Hidden" } },
      ]),
    });

    expect(result.slots).toEqual({ "starter-hero": { heading: "Shown" } });
    expect(result.hiddenSlots).toEqual(["starter-promo"]);
  });

  it("reports nothing hidden when every section is enabled", async () => {
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/",
      ports: ports([{ id: "starter-hero", enabled: true, props: {} }]),
    });
    expect(result.hiddenSlots).toEqual([]);
  });
});

describe("pageHandleForPath (RUNTIME-02)", () => {
  it("reads the handle a page path addresses", () => {
    expect(pageHandleForPath("/pages/about")).toBe("about");
    expect(pageHandleForPath("/pages/about/")).toBe("about");
    expect(pageHandleForPath("/pages/about?x=1")).toBe("about");
  });

  it("is not a page path", () => {
    expect(pageHandleForPath("/")).toBeNull();
    expect(pageHandleForPath("/products/mug")).toBeNull();
    expect(pageHandleForPath("/pages/")).toBeNull();
    // A deeper path is not a Page this can resolve; answering with `about`
    // would serve the wrong content for it.
    expect(pageHandleForPath("/pages/about/team")).toBeNull();
  });

  // Every Page used to resolve as the generic page *template*, so two
  // published Pages rendered identically.
  it("resolves a Page by handle in preference to the template", async () => {
    const getPublishedPageDocument = vi.fn(async () => ({
      sections: [{ id: "s", enabled: true, props: { heading: "About" } }],
    }));
    const getPublishedDocument = vi.fn(async () => ({
      sections: [{ id: "s", enabled: true, props: { heading: "Template" } }],
    }));

    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/pages/about",
      ports: { getPublishedDocument, getPublishedPageDocument } as never,
    });

    expect(result.slots).toEqual({ s: { heading: "About" } });
    expect(getPublishedPageDocument).toHaveBeenCalledWith({
      publicationId: "pub_1",
      handle: "about",
    });
  });

  it("falls back to the template when no Page is published at that handle", async () => {
    const result = await resolveStorefrontContent({
      publicationId: "pub_1",
      pathname: "/pages/about",
      ports: {
        getPublishedPageDocument: vi.fn(async () => null),
        getPublishedDocument: vi.fn(async () => ({
          sections: [{ id: "s", enabled: true, props: { heading: "Template" } }],
        })),
      } as never,
    });

    expect(result.slots).toEqual({ s: { heading: "Template" } });
  });
});
