import { describe, expect, it } from "vitest";
import {
  identifyUnstoredListRows,
  MIGRATED_ROW_ID_PREFIX,
  normalizeDocumentRowIds,
  normalizeRowIds,
} from "./normalize-row-ids";
import { createMorphItemId } from "./reorder-array-items";

const scope = { templateId: "tpl-1", sectionId: "starter-header" };

describe("normalizeRowIds", () => {
  it("gives every row an id and leaves the rest of the props alone", () => {
    const result = normalizeRowIds(
      {
        storeName: "Online Store",
        navItems: [
          { label: "Shop", link: { href: "/collections/all" } },
          { label: "About", link: { href: "/pages/about" } },
        ] as { id?: string; label: string; link: { href: string } }[],
        cartLabel: "Cart (0)",
      },
      scope,
    );

    expect(result.changed).toBe(true);
    expect(result.assigned).toBe(2);
    expect(result.value.storeName).toBe("Online Store");
    expect(result.value.cartLabel).toBe("Cart (0)");
    for (const row of result.value.navItems) {
      expect(row.id).toMatch(/^morph-mig-[0-9a-f]{16}$/);
    }
  });

  it("keeps ids that already exist", () => {
    const result = normalizeRowIds(
      { navItems: [{ id: "morph-kept", label: "Shop" }, { label: "About" }] },
      scope,
    );

    expect(result.assigned).toBe(1);
    expect(result.value.navItems[0]).toEqual({
      id: "morph-kept",
      label: "Shop",
    });
  });

  /**
   * The case that silently breaks React's matching without ever looking wrong
   * in the data: two rows claiming the same identity. The first keeps it, so a
   * row that already carries instance styles does not lose them.
   */
  it("re-issues a duplicate id rather than leaving two rows sharing one", () => {
    const result = normalizeRowIds(
      {
        navItems: [
          { id: "same", label: "Shop" },
          { id: "same", label: "About" },
          { id: "same", label: "Journal" },
        ],
      },
      scope,
    );

    expect(result.deduplicated).toBe(2);
    const ids = result.value.navItems.map((row) => row.id);
    expect(ids[0]).toBe("same");
    expect(new Set(ids).size).toBe(3);
  });

  /**
   * A repair must not land on an id a later row is still holding, or the fix
   * creates the collision it was called to remove.
   */
  it("keeps a repaired id clear of every id already in the array", () => {
    const result = normalizeRowIds(
      {
        navItems: [
          { label: "Shop" },
          { id: "morph-mig-taken", label: "About" },
          { id: "morph-mig-taken", label: "Journal" },
        ],
      },
      scope,
    );

    const ids = result.value.navItems.map((row) => row.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe("morph-mig-taken");
  });

  it("treats each array separately, so two lists may share an id", () => {
    expect(
      normalizeRowIds(
        {
          exploreItems: [{ id: "shared", label: "Shop all" }],
          helpItems: [{ id: "shared", label: "Contact" }],
        },
        scope,
      ).changed,
    ).toBe(false);
  });

  it("is idempotent", () => {
    const first = normalizeRowIds(
      { navItems: [{ label: "Shop" }, { label: "About" }] },
      scope,
    );
    const second = normalizeRowIds(first.value, scope);

    expect(second.changed).toBe(false);
    expect(second.value).toBe(first.value);
  });

  it("returns the original reference when there is nothing to do", () => {
    const props = { navItems: [{ id: "one", label: "Shop" }] };
    const result = normalizeRowIds(props, scope);

    expect(result.changed).toBe(false);
    expect(result.value).toBe(props);
  });

  it("preserves row order", () => {
    const result = normalizeRowIds(
      { rows: [{ label: "a" }, { label: "b" }, { label: "c" }] },
      scope,
    );

    expect(result.value.rows.map((row) => row.label)).toEqual(["a", "b", "c"]);
  });

  it("reaches rows nested inside other rows", () => {
    const result = normalizeRowIds(
      {
        groups: [{ label: "Explore", links: [{ label: "Shop all" }] }] as {
          id?: string;
          label: string;
          links: { id?: string; label: string }[];
        }[],
      },
      scope,
    );

    expect(result.assigned).toBe(2);
    expect(result.value.groups[0].id).toMatch(/^morph-mig-/);
    expect(result.value.groups[0].links[0].id).toMatch(/^morph-mig-/);
  });

  it("leaves arrays that are not rows untouched", () => {
    const props = {
      tags: ["new", "sale"],
      sizes: [1, 2, 3],
      mixed: [{ label: "a" }, "b"],
      empty: [],
      link: { href: "/cart" },
    };

    expect(normalizeRowIds(props, scope).changed).toBe(false);
  });

  /** An id that is present but unusable is a missing id, not one to keep. */
  it("replaces an id that is blank or not a string", () => {
    const result = normalizeRowIds(
      { rows: [{ id: "   " }, { id: 7 }, { id: null }] },
      scope,
    );

    expect(result.assigned).toBe(3);
    expect(
      result.value.rows.every((row) => /^morph-mig-/.test(String(row.id))),
    ).toBe(true);
  });

  it("does not mutate the document it was given", () => {
    const props = { navItems: [{ label: "Shop" }] };
    normalizeRowIds(props, scope);

    expect(props).toEqual({ navItems: [{ label: "Shop" }] });
  });
});

describe("normalizeRowIds is reproducible across sides", () => {
  const document = {
    navItems: [
      { label: "Shop", link: { href: "/collections/all" } },
      { label: "About", link: { href: "/pages/about" } },
      { id: "morph-kept", label: "Journal" },
      { id: "morph-kept", label: "Sale" },
      { id: "", label: "Blank" },
    ],
  };

  /**
   * The browser normalizes at load and the server normalizes again when the
   * first edit is saved. If the two disagree, the save renumbers rows the
   * author is looking at and React remounts every one of them.
   */
  it("gives the same JSON for the same input, run twice", () => {
    const browser = normalizeRowIds(structuredClone(document), scope);
    const server = normalizeRowIds(structuredClone(document), scope);

    expect(JSON.stringify(server.value)).toBe(JSON.stringify(browser.value));
  });

  /**
   * Key order is not guaranteed to survive a JSON round trip through the
   * database, so an id that depended on it would differ between the copy held
   * in the browser and the copy read back on the server.
   */
  it("does not depend on the order keys happen to be written in", () => {
    const reordered = {
      navItems: [
        { link: { href: "/collections/all" }, label: "Shop" },
        { link: { href: "/pages/about" }, label: "About" },
        { label: "Journal", id: "morph-kept" },
        { label: "Sale", id: "morph-kept" },
        { label: "Blank", id: "" },
      ],
    };

    const fromOriginal = normalizeRowIds(
      structuredClone(document),
      scope,
    ).value;
    const fromReordered = normalizeRowIds(reordered, scope).value;

    expect(fromReordered.navItems.map((row) => row.id)).toEqual(
      fromOriginal.navItems.map((row) => row.id),
    );
  });

  it("gives the same row a different id in a different section", () => {
    const here = normalizeRowIds(structuredClone(document), scope).value;
    const there = normalizeRowIds(structuredClone(document), {
      templateId: scope.templateId,
      sectionId: "starter-footer",
    }).value;

    expect(there.navItems[0].id).not.toBe(here.navItems[0].id);
  });

  it("gives the same row a different id in a different template", () => {
    const here = normalizeRowIds(structuredClone(document), scope).value;
    const there = normalizeRowIds(structuredClone(document), {
      templateId: "tpl-2",
      sectionId: scope.sectionId,
    }).value;

    expect(there.navItems[0].id).not.toBe(here.navItems[0].id);
  });

  /**
   * The two namespaces must not be able to meet. A repair that looked like a
   * minted id — or the reverse — would make it impossible to tell a row the
   * author created from one this migration touched.
   */
  it("never produces an id createMorphItemId could produce", () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(createMorphItemId().startsWith(MIGRATED_ROW_ID_PREFIX)).toBe(
        false,
      );
    }
  });
});

describe("identifyUnstoredListRows", () => {
  const items = [{ title: "One" }, { title: "Two" }];
  const links = [{ label: "Alpha" }, { label: "Beta" }];
  const serverRows = () =>
    normalizeDocumentRowIds(
      { sections: [{ id: scope.sectionId, props: { items, links } }] },
      scope.templateId,
    ).value.sections[0]!.props as unknown as {
      items: Array<{ id: string }>;
      links: Array<{ id: string }>;
    };

  it("gives one list the ids the server gives it, whatever else the section holds", () => {
    expect(identifyUnstoredListRows("items", items, scope)).toEqual(
      serverRows().items,
    );
    expect(identifyUnstoredListRows("links", links, scope)).toEqual(
      serverRows().links,
    );
  });

  it("keeps the ids it gave, so a seed drawn with them derives nothing again", () => {
    const shown = identifyUnstoredListRows("items", items, scope);
    expect(identifyUnstoredListRows("items", shown, scope)).toBe(shown);
  });

  it("keeps an id a default row already has, and derives only the missing one", () => {
    const rows = identifyUnstoredListRows(
      "items",
      [{ id: "hand-written", title: "One" }, { title: "Two" }],
      scope,
    ) as Array<{ id: string; title: string }>;
    expect(rows[0]).toEqual({ id: "hand-written", title: "One" });
    expect(rows[1]!.id.startsWith(MIGRATED_ROW_ID_PREFIX)).toBe(true);
  });

  /**
   * Why the caller must only ever hand it rows as declared: the id depends on
   * the content, so rows carrying a keystroke would derive another id.
   */
  it("derives from the content it is given", () => {
    const before = identifyUnstoredListRows("items", items, scope) as Array<{
      id: string;
    }>;
    const after = identifyUnstoredListRows(
      "items",
      [{ title: "One" }, { title: "Two!" }],
      scope,
    ) as Array<{ id: string }>;
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[1]!.id).not.toBe(before[1]!.id);
  });

  it("leaves a value that is not a row list as it is", () => {
    expect(identifyUnstoredListRows("items", [], scope)).toEqual([]);
    expect(identifyUnstoredListRows("items", undefined, scope)).toBe(
      undefined,
    );
  });
});
