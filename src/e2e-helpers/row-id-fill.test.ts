import { describe, expect, it } from "vitest";
import { normalizeDocumentRowIds } from "@/lib/storefront/editor/normalize-row-ids";
import {
  compareStoredWrite,
  type StoredDocument,
} from "../../e2e/helpers/row-id-fill";

const LAYOUT = "layout-template";
const INDEX = "index-template";

type Doc = {
  templateId: string;
  sections: Array<{ id: string; props: Record<string, unknown> }>;
};

/**
 * The shape of the 1b v20 failure: a rolled-back layout whose Header and
 * Footer rows carry no `id`, beside an index Document whose rows already do.
 */
function stored(): Doc[] {
  return [
    {
      templateId: INDEX,
      sections: [
        {
          id: "starter-categories",
          props: {
            heading: "Shop",
            items: [
              { title: "A", link: { href: "/a" }, id: "card-a" },
              { title: "B", link: { href: "/b" }, id: "card-b" },
            ],
          },
        },
      ],
    },
    {
      templateId: LAYOUT,
      sections: [
        {
          id: "starter-header",
          props: {
            storeName: "Store",
            navItems: [
              { label: "Shop", link: { href: "/shop" } },
              { label: "About", link: { href: "/about" } },
              { label: "Journal", link: { href: "/journal" } },
            ],
            cartLabel: "Cart",
            cartLink: { href: "/cart" },
          },
        },
        {
          id: "starter-footer",
          props: {
            storeName: "Store",
            exploreItems: [
              { label: "All", link: { href: "/all" } },
              { label: "Story", link: { href: "/story" } },
            ],
          },
        },
      ],
    },
  ];
}

/** What the editor reads: the same Documents through the product's own repair. */
function editorRead(docs: Doc[]): Doc[] {
  return docs.map((doc) => ({
    ...doc,
    sections: normalizeDocumentRowIds(doc, doc.templateId).value.sections,
  }));
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function section(docs: Doc[], templateId: string, sectionId: string) {
  return docs
    .find((doc) => doc.templateId === templateId)!
    // `any`: the fixtures edit nested props freely.
    .sections.find((s) => s.id === sectionId)!.props as Record<string, any>;
}

/** The read as the first write persists it: the edit plus every repaired id. */
function persisted(read: Doc[], edit?: (docs: Doc[]) => void): Doc[] {
  const docs = clone(read);
  edit?.(docs);
  return docs;
}

const storeNameEdit = {
  sectionId: "starter-header",
  location: "storeName",
  value: "1b0-written",
};

function writeOf(after: Doc[], read = editorRead(stored())) {
  return compareStoredWrite({
    before: stored() as StoredDocument[],
    normalizedRead: read,
    after,
    templateId: LAYOUT,
    edit: storeNameEdit,
  });
}

describe("compareStoredWrite: the write", () => {
  it("accepts the edited leaf plus each missing id filled as the editor read it", () => {
    const read = editorRead(stored());
    const after = persisted(read, (docs) => {
      section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
    });
    const result = writeOf(after, read);
    expect(result.problems).toEqual([]);
    const header = section(read, LAYOUT, "starter-header");
    const footer = section(read, LAYOUT, "starter-footer");
    expect(result.filledRowIds).toEqual(
      [
        ...[0, 1, 2].map((n) => ({
          key: `${LAYOUT}/starter-header/navItems.${n}.id`,
          templateId: LAYOUT,
          sectionId: "starter-header",
          path: `navItems.${n}`,
          id: header.navItems[n].id,
        })),
        ...[0, 1].map((n) => ({
          key: `${LAYOUT}/starter-footer/exploreItems.${n}.id`,
          templateId: LAYOUT,
          sectionId: "starter-footer",
          path: `exploreItems.${n}`,
          id: footer.exploreItems[n].id,
        })),
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(result.filledRowIds.every((f) => f.id.startsWith("morph-mig-"))).toBe(
      true,
    );
  });

  it("accepts an edit inside a row whose id is filled from the row as read before the edit", () => {
    const read = editorRead(stored());
    const after = persisted(read, (docs) => {
      section(docs, LAYOUT, "starter-header").navItems[0].label = "1b2-written";
    });
    const result = compareStoredWrite({
      before: stored(),
      normalizedRead: read,
      after,
      templateId: LAYOUT,
      edit: {
        sectionId: "starter-header",
        location: "navItems.0.label",
        value: "1b2-written",
      },
    });
    expect(result.problems).toEqual([]);
    expect(result.filledRowIds.map((f) => f.path)).toContain("navItems.0");
  });

  it("accepts a write with nothing to fill", () => {
    const base = editorRead(stored());
    const after = persisted(base, (docs) => {
      section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
    });
    const result = compareStoredWrite({
      before: base,
      normalizedRead: base,
      after,
      templateId: LAYOUT,
      edit: storeNameEdit,
    });
    expect(result).toEqual({
      problems: [],
      filledRowIds: [],
      componentRefRewrites: [],
    });
  });

  it("rejects a change of an id the Document already held", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
      section(docs, INDEX, "starter-categories").items[1].id = "card-b2";
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects ids swapped between two rows (an id filled on the wrong row)", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      const first = header.navItems[0].id;
      header.navItems[0].id = header.navItems[1].id;
      header.navItems[1].id = first;
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects an id added to something that is not a row", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.cartLink.id = header.navItems[0].id;
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects an id filled in a Document the write did not go to", () => {
    const before = stored();
    delete section(before, INDEX, "starter-categories").items[0].id;
    const read = editorRead(before);
    const after = persisted(read, (docs) => {
      section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
    });
    const result = compareStoredWrite({
      before,
      normalizedRead: read,
      after,
      templateId: LAYOUT,
      edit: storeNameEdit,
    });
    expect(result.problems).not.toEqual([]);
  });

  it("rejects rows reordered", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.navItems.reverse();
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects a link changed", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.navItems[1].link.href = "/elsewhere";
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects another leaf changed", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.cartLabel = "Bag";
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects a filled id that is not the one the editor read showed", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.navItems[2].id = "morph-mig-0000000000000000";
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects a filled id when the editor read's row is not the stored row", () => {
    const read = editorRead(stored());
    // The read the id came from showed different content for that row.
    section(read, LAYOUT, "starter-header").navItems[0].label = "Shop now";
    const after = persisted(editorRead(stored()), (docs) => {
      section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
      section(docs, LAYOUT, "starter-header").navItems[0].id = section(
        read,
        LAYOUT,
        "starter-header",
      ).navItems[0].id;
    });
    expect(writeOf(after, read).problems).not.toEqual([]);
  });

  it("rejects a row added", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.navItems.push({ label: "New", link: { href: "/new" }, id: "x" });
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects a row removed", () => {
    const after = persisted(editorRead(stored()), (docs) => {
      const header = section(docs, LAYOUT, "starter-header");
      header.storeName = "1b0-written";
      header.navItems.pop();
    });
    expect(writeOf(after).problems).not.toEqual([]);
  });

  it("rejects the edited leaf not holding the written value", () => {
    const after = persisted(editorRead(stored()));
    expect(writeOf(after).problems).not.toEqual([]);
  });
});

describe("compareStoredWrite: the restore", () => {
  function written() {
    const read = editorRead(stored());
    const after = persisted(read, (docs) => {
      section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
    });
    return { read, fills: writeOf(after, read).filledRowIds };
  }

  it("accepts the stored Document back, plus the ids the write filled", () => {
    const { read, fills } = written();
    expect(fills.length).toBe(5);
    const result = compareStoredWrite({
      before: stored(),
      normalizedRead: read,
      after: persisted(read),
      templateId: LAYOUT,
      edit: null,
      expectedFills: fills,
    });
    expect(result.problems).toEqual([]);
    expect(result.filledRowIds).toEqual(fills);
  });

  it("rejects the restore when the filled ids are gone again", () => {
    const { read, fills } = written();
    const result = compareStoredWrite({
      before: stored(),
      normalizedRead: read,
      after: stored(),
      templateId: LAYOUT,
      edit: null,
      expectedFills: fills,
    });
    expect(result.problems).not.toEqual([]);
  });

  it("rejects the restore when the edited value stayed", () => {
    const { read, fills } = written();
    const result = compareStoredWrite({
      before: stored(),
      normalizedRead: read,
      after: persisted(read, (docs) => {
        section(docs, LAYOUT, "starter-header").storeName = "1b0-written";
      }),
      templateId: LAYOUT,
      edit: null,
      expectedFills: fills,
    });
    expect(result.problems).not.toEqual([]);
  });

  it("rejects the restore when an id changed after the write", () => {
    const { read, fills } = written();
    const result = compareStoredWrite({
      before: stored(),
      normalizedRead: read,
      after: persisted(read, (docs) => {
        section(docs, LAYOUT, "starter-footer").exploreItems[0].id = "other";
      }),
      templateId: LAYOUT,
      edit: null,
      expectedFills: fills,
    });
    expect(result.problems).not.toEqual([]);
  });
});

describe("compareStoredWrite: the edited section's componentRef", () => {
  const INTRO_NEW = "src/components/page-sections/index/starter-introduction/index.tsx";
  const PRINCIPLES_NEW = "src/components/page-sections/index/starter-principles/index.tsx";
  const introRewrite = {
    sectionId: "starter-introduction",
    from: "editorial-intro.default",
    to: INTRO_NEW,
  };

  /** An index Document whose sections still store legacy registry refs. */
  function home(): StoredDocument[] {
    return [
      {
        templateId: INDEX,
        sections: [
          {
            id: "starter-introduction",
            type: "editorial-intro",
            componentRef: "editorial-intro.default",
            enabled: true,
            props: { label: "Intro", heading: "H", body: "B" },
          },
          {
            id: "starter-principles",
            type: "principles",
            componentRef: "principles.default",
            enabled: true,
            props: {
              label: "Principles",
              items: [{ id: "p1", number: "01", title: "T", body: "B" }],
            },
          },
        ] as StoredDocument["sections"],
      },
    ];
  }

  type Section = StoredDocument["sections"][number] & Record<string, unknown>;
  const sectionOf = (docs: StoredDocument[], id: string) =>
    docs[0]!.sections.find((s) => s.id === id) as Section;

  /** The stored Documents after the write: the edit, plus `change`. */
  function afterWrite(change?: (docs: StoredDocument[]) => void, edited = "Intro 2") {
    const docs = clone(home());
    sectionOf(docs, "starter-introduction").props!.label = edited;
    change?.(docs);
    return docs;
  }

  const introEdit = {
    sectionId: "starter-introduction",
    location: "label",
    value: "Intro 2",
  };

  function write(after: StoredDocument[], rewrite = introRewrite as typeof introRewrite | null, before = home()) {
    return compareStoredWrite({
      before,
      normalizedRead: before,
      after,
      templateId: INDEX,
      edit: introEdit,
      componentRefRewrite: rewrite,
    });
  }

  const rewritten = (docs: StoredDocument[]) => {
    sectionOf(docs, "starter-introduction").componentRef = INTRO_NEW;
  };

  it("accepts the edited section's legacy ref rewritten to exactly the fixed route-derived path", () => {
    const result = write(afterWrite(rewritten));
    expect(result.problems).toEqual([]);
    expect(result.componentRefRewrites).toEqual([
      {
        key: `${INDEX}/starter-introduction/componentRef`,
        templateId: INDEX,
        sectionId: "starter-introduction",
        from: "editorial-intro.default",
        to: INTRO_NEW,
      },
    ]);
  });

  it("accepts the write when the ref is left as it was", () => {
    const result = write(afterWrite());
    expect(result.problems).toEqual([]);
    expect(result.componentRefRewrites).toEqual([]);
  });

  it("rejects the ref rewritten to the old manifest path", () => {
    const after = afterWrite((docs) => {
      sectionOf(docs, "starter-introduction").componentRef = "src/components/EditorialIntro.tsx";
    });
    expect(write(after).problems).not.toEqual([]);
  });

  it("rejects the ref rewritten to another existing component's path", () => {
    const after = afterWrite((docs) => {
      sectionOf(docs, "starter-introduction").componentRef = PRINCIPLES_NEW;
    });
    expect(write(after).problems).not.toEqual([]);
  });

  it("rejects a sibling section's ref changed", () => {
    const after = afterWrite((docs) => {
      rewritten(docs);
      sectionOf(docs, "starter-principles").componentRef = PRINCIPLES_NEW;
    });
    expect(write(after).problems).not.toEqual([]);
  });

  it("rejects a ref change on an edited section the table does not list", () => {
    const after = afterWrite(rewritten);
    expect(write(after, null).problems).not.toEqual([]);
  });

  it("rejects a table entry for a section other than the edited one", () => {
    const before = home();
    const after = clone(before);
    sectionOf(after, "starter-principles").props!.label = "P2";
    sectionOf(after, "starter-introduction").componentRef = INTRO_NEW;
    const result = compareStoredWrite({
      before,
      normalizedRead: before,
      after,
      templateId: INDEX,
      edit: { sectionId: "starter-principles", location: "label", value: "P2" },
      componentRefRewrite: introRewrite,
    });
    expect(result.problems).not.toEqual([]);
  });

  it("rejects the rewrite when the stored ref is not the table's old ref", () => {
    const before = home();
    sectionOf(before, "starter-introduction").componentRef = "editorial-intro.alt";
    const after = clone(before);
    sectionOf(after, "starter-introduction").props!.label = "Intro 2";
    rewritten(after);
    expect(write(after, introRewrite, before).problems).not.toEqual([]);
  });

  it("rejects a section's type or enabled changed alongside the rewrite", () => {
    const typed = afterWrite((docs) => {
      rewritten(docs);
      sectionOf(docs, "starter-introduction").type = "intro";
    });
    expect(write(typed).problems).not.toEqual([]);
    const hidden = afterWrite((docs) => {
      rewritten(docs);
      sectionOf(docs, "starter-introduction").enabled = false;
    });
    expect(write(hidden).problems).not.toEqual([]);
  });

  describe("the restore", () => {
    function restoreOf(after: StoredDocument[]) {
      const made = write(afterWrite(rewritten)).componentRefRewrites;
      return compareStoredWrite({
        before: home(),
        normalizedRead: home(),
        after,
        templateId: INDEX,
        edit: null,
        componentRefRewrite: introRewrite,
        expectedFills: [],
        expectedRewrites: made,
      });
    }

    it("accepts the value back with the same rewrite kept", () => {
      const after = clone(home());
      rewritten(after);
      const result = restoreOf(after);
      expect(result.problems).toEqual([]);
      expect(result.componentRefRewrites.map((r) => r.to)).toEqual([INTRO_NEW]);
    });

    it("rejects the rewrite reverted", () => {
      expect(restoreOf(home()).problems).not.toEqual([]);
    });

    it("rejects another change added", () => {
      const after = clone(home());
      rewritten(after);
      sectionOf(after, "starter-principles").componentRef = PRINCIPLES_NEW;
      expect(restoreOf(after).problems).not.toEqual([]);
      const leaf = clone(home());
      rewritten(leaf);
      sectionOf(leaf, "starter-introduction").props!.heading = "H2";
      expect(restoreOf(leaf).problems).not.toEqual([]);
    });

    it("rejects a rewrite the write did not make", () => {
      const after = clone(home());
      rewritten(after);
      const result = compareStoredWrite({
        before: home(),
        normalizedRead: home(),
        after,
        templateId: INDEX,
        edit: null,
        componentRefRewrite: introRewrite,
        expectedFills: [],
        expectedRewrites: [],
      });
      expect(result.problems).not.toEqual([]);
    });
  });
});
