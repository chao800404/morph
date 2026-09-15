import { describe, expect, it } from "vitest";
import { stripDerivableMarkers } from "./strip-derivable-markers";
import {
  LEGACY_STARTER_THEME_PRODUCT_DETAIL_MARKED_SOURCE,
  LEGACY_STARTER_THEME_PRODUCT_LIST_MARKED_SOURCE,
  starterThemeCatalogSource,
} from "../starter-theme-catalog-files";

const strip = (content: string, path = "src/components/Thing.tsx") =>
  stripDerivableMarkers({ path, content });

describe("removing markers the compiler derives", () => {
  /**
   * The workspace this was written for: a Starter component an author has
   * since edited, which is why no byte-exact upgrade will ever reach it.
   */
  it("cleans a component whose other bytes no longer match the Starter", () => {
    const authored = `import type { ThemeContentFields } from "../morph/content-fields";

export type PrinciplesProps = { label?: string };

export const contentFields = {
  label: { type: "text", label: "Label", maxLength: 100 },
} as const satisfies ThemeContentFields;

export default function Principles({ label = "Why we choose differently" }: PrinciplesProps) {
  return (
    <section className="bg-stone-50">
      <p
        data-storefront-field="label"
        className="mb-14 text-xs"
      >
        {label}
      </p>
    </section>
  );
}
`;
    const result = strip(authored);
    expect(result?.removed).toBe(1);
    expect(result?.content).not.toContain("data-storefront-field");
    // The attribute took its own line and nothing else.
    expect(result?.content).toContain(
      '      <p\n        className="mb-14 text-xs"\n      >',
    );
  });

  it("clears every hand-written name from the catalog generation that had them", () => {
    for (const marked of [
      LEGACY_STARTER_THEME_PRODUCT_LIST_MARKED_SOURCE,
      LEGACY_STARTER_THEME_PRODUCT_DETAIL_MARKED_SOURCE,
    ]) {
      const result = strip(marked);
      expect(result).not.toBeNull();
      expect(result!.content).not.toMatch(/data-morph-node/);
    }
  });

  // The transform has to agree with the copy the Starter now ships, or the two
  // routes to a clean file would disagree about what clean means.
  it("lands on the source the generator already writes", () => {
    expect(
      strip(LEGACY_STARTER_THEME_PRODUCT_LIST_MARKED_SOURCE)?.content,
    ).toBe(starterThemeCatalogSource("src/components/ProductList.tsx"));
    expect(
      strip(LEGACY_STARTER_THEME_PRODUCT_DETAIL_MARKED_SOURCE)?.content,
    ).toBe(starterThemeCatalogSource("src/components/ProductDetail.tsx"));
  });

  it("keeps a marker the compiler cannot reproduce", () => {
    // `title` is never declared, so the compiler would bind nothing here and
    // the author's marker is the only thing making the element editable.
    const source = `export default function Card({ heading }) {
  return <h2 data-storefront-field="title">{heading}</h2>;
}
`;
    expect(strip(source)).toBeNull();
  });

  it("keeps a marker that names a different field than the expression reads", () => {
    const source = `export const contentFields = {
  heading: { type: "text" },
  body: { type: "text" },
} as const;
export default function Card({ heading, body }) {
  return <div><h2 data-storefront-field="body">{heading}</h2><p>{body}</p></div>;
}
`;
    expect(strip(source)).toBeNull();
  });

  it("leaves a name the author chose, which no analysis can recover", () => {
    const source = `export default function Header() {
  return <header data-morph-element="brand"><span>Shop</span></header>;
}
`;
    expect(strip(source)).toBeNull();
  });

  it("declines a file it cannot parse, rather than rewriting it", () => {
    expect(
      strip(
        `export default function Broken( {\n  <div data-morph-node="x" />\n`,
      ),
    ).toBeNull();
  });

  it("has nothing to say about a file with no markers", () => {
    expect(
      strip(`export default function Clean() {\n  return <p>Hi</p>;\n}\n`),
    ).toBeNull();
  });

  it("ignores a file that is not JSX", () => {
    expect(
      stripDerivableMarkers({
        path: "src/morph/catalog.ts",
        content: `export const note = 'data-morph-node';\n`,
      }),
    ).toBeNull();
  });

  it("removes a row's derived path and identity together", () => {
    const source = `export const contentFields = {
  items: { type: "array", fields: { title: { type: "text" } } },
} as const;
export default function List({ items = [] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={item.id} data-storefront-item-id={item?.id}>
          <span data-storefront-field="title" data-storefront-field-path={\`items.\${i}.title\`}>{item.title}</span>
        </li>
      ))}
    </ul>
  );
}
`;
    const result = strip(source);
    expect(result?.removed).toBe(3);
    expect(result?.content).not.toMatch(/data-storefront-(field|item-id)/);
  });
});
