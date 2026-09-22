import { describe, expect, it } from "vitest";
import { inferThemeContentFields } from "./infer-theme-content-fields";

describe("inferThemeContentFields", () => {
  it("infers primitive defaults from an ordinary React component", () => {
    const result = inferThemeContentFields(`
      export default function Promo({
        title = "Limited offer",
        showBadge = true,
        columns = 3,
      }) { return null; }
    `);

    expect(result.fields).toEqual({
      title: { type: "text" },
      showBadge: { type: "boolean" },
      columns: { type: "number" },
    });
  });

  it("reads same-file props interfaces and string unions", () => {
    const result = inferThemeContentFields(`
      interface PromoProps {
        title?: string;
        align?: "left" | "center" | "right";
        image?: { src: string; alt: string };
      }
      export default function Promo(props: PromoProps) { return null; }
    `);

    expect(result.fields).toEqual({
      title: { type: "text" },
      align: {
        type: "select",
        options: [
          { label: "left", value: "left" },
          { label: "center", value: "center" },
          { label: "right", value: "right" },
        ],
      },
      image: { type: "image" },
    });
  });

  it("applies a same-file props type to destructured parameters", () => {
    const result = inferThemeContentFields(`
      type PromoProps = {
        title?: string;
        showBadge?: boolean;
        image?: { src: string; alt: string };
      };
      export default function Promo({ title, showBadge, image }: PromoProps) {
        return null;
      }
    `);

    expect(result.fields).toEqual({
      title: { type: "text" },
      showBadge: { type: "boolean" },
      image: { type: "image" },
    });
  });

  it("does not guess that a plain string named image is media", () => {
    const result = inferThemeContentFields(`
      export default function Promo({ image = "/banner.jpg" }) { return null; }
    `);

    expect(result.fields).toEqual({ image: { type: "text" } });
  });

  it("does not follow imported or runtime types", () => {
    const result = inferThemeContentFields(`
      import type { ProductProps } from "./types";
      export default function Promo(props: ProductProps) { return null; }
    `);

    expect(result.fields).toEqual({});
  });

  it("reads an inline object type written at the parameter", () => {
    // Regression. This path used to look up a named alias only, so an inline
    // type at the parameter inferred nothing while the destructured form
    // inferred everything. Both are ordinary React and have to agree.
    const result = inferThemeContentFields(`
      export default function Promo(props: { title: string; count: number }) {
        return null;
      }
    `);

    expect(result.fields).toEqual({
      title: { type: "text" },
      count: { type: "number" },
    });
  });

  it("infers the same fields whether the parameter is destructured or not", () => {
    const shape = `{ title: string; count: number }`;
    const named = inferThemeContentFields(`
      export default function Promo(props: ${shape}) { return null; }
    `);
    const destructured = inferThemeContentFields(`
      export default function Promo({ title, count }: ${shape}) { return null; }
    `);

    // The non-empty assertion is what gives the comparison its teeth: two
    // empty results agree with each other, so equality alone would hold even
    // with both paths broken.
    expect(Object.keys(named.fields).length).toBeGreaterThan(0);
    expect(named.fields).toEqual(destructured.fields);
  });
});

describe("what inference refuses to guess", () => {
  // Each case is a field an author would expect to see and does not. The
  // contract is that `contentFields` declares those, so a silent skip is
  // correct and a guess would not be: the editor must never invent a type it
  // cannot prove from the source.
  const infer = (source: string) => inferThemeContentFields(source).fields;

  it("reads an object default shaped { src, alt } as an image", () => {
    expect(
      infer(
        `export default function Promo({ image = { src: "/a.png", alt: "x" } }) { return null; }`,
      ),
    ).toEqual({ image: { type: "image" } });
  });

  it("refuses a partial image object, which is only proven to be an object", () => {
    expect(
      infer(
        `export default function Promo({ image = { src: "/a.png" } }) { return null; }`,
      ),
    ).toEqual({});
  });

  it("refuses a runtime value used as a default", () => {
    expect(
      infer(
        `export default function Promo({ title = product.name }) { return null; }`,
      ),
    ).toEqual({});
  });

  it("refuses a null default", () => {
    expect(
      infer(`export default function Promo({ title = null }) { return null; }`),
    ).toEqual({});
  });

  it("refuses an array, which needs a row shape contentFields declares", () => {
    expect(
      infer(
        `interface P { items: string[] }
export default function Promo(props: P) { return null; }`,
      ),
    ).toEqual({});
  });

  it("refuses a union that is not entirely string literals", () => {
    expect(
      infer(
        `interface P { v: string | number }
export default function Promo(props: P) { return null; }`,
      ),
    ).toEqual({});
  });

  it("refuses a union that repeats a literal", () => {
    // A select whose options repeat is not a select; the guard that rejects it
    // is the same one that keeps `"a" | "b"` from becoming two identical rows.
    expect(
      infer(
        `interface P { v: "a" | "a" }
export default function Promo(props: P) { return null; }`,
      ),
    ).toEqual({});
  });
});
