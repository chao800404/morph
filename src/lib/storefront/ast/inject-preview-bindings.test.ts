// @vitest-environment node
import { describe, expect, it } from "vitest";
import { injectPreviewBindings } from "./inject-preview-bindings";

const run = (content: string, path = "src/components/Hero.tsx") =>
  injectPreviewBindings([{ path, content }]).files[0]!.content;

const DECLARES = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: {
    type: "array",
    label: "Items",
    fields: { title: { type: "text" }, image: { type: "image" } },
  },
} as const;
`;

describe("writing editor identity into a Theme for a real React preview", () => {
  it("names the field an element shows, from the expression it renders", () => {
    const out = run(`${DECLARES}
export default function Hero({ heading }) {
  return <h1>{heading}</h1>;
}
`);
    expect(out).toContain('data-storefront-field="heading"');
    expect(out).toContain("{heading}</h1>");
  });

  it("records where in the source each element was written", () => {
    const out = run(
      `export default function Hero() {\n  return <p>hi</p>;\n}\n`,
    );
    expect(out).toContain('data-morph-loc="src/components/Hero.tsx:2:11"');
  });

  it("addresses a repeated row by index, evaluated when React runs the loop", () => {
    const out = run(`${DECLARES}
export default function Hero({ items = [] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  );
}
`);
    // A template expression, because the index only exists at run time.
    expect(out).toContain(
      "data-storefront-field-path={`items.${index}.title`}",
    );
    expect(out).toContain('data-storefront-field="title"');
  });

  it("gives each row an identity that survives a reorder", () => {
    const out = run(`${DECLARES}
export default function Hero({ items = [] }) {
  return <ul>{items.map((item, index) => <li key={item.id}>{item.title}</li>)}</ul>;
}
`);
    expect(out).toContain("data-storefront-item-id={item?.id}");
  });

  it("follows a member chain to the field it reads into", () => {
    const out = run(`${DECLARES}
export default function Hero({ items = [] }) {
  return <ul>{items.map((item, i) => <img key={i} src={item.image?.src ?? ""} />)}</ul>;
}
`);
    expect(out).toContain('data-storefront-field="image"');
    expect(out).toContain("data-storefront-field-path={`items.${i}.image`}");
  });

  it("marks nothing the component never declared", () => {
    // A compiler cannot see which props arrived, so the declaration is the
    // only statement of intent it has. Marking more would put fields in the
    // Inspector that write nowhere.
    const out = run(`${DECLARES}
export default function Hero({ heading, secret }) {
  return <><h1>{heading}</h1><span>{secret}</span></>;
}
`);
    expect(out).toContain('data-storefront-field="heading"');
    expect(out).not.toContain('data-storefront-field="secret"');
  });

  it("leaves another component's element to that component", () => {
    const out = run(`${DECLARES}
export default function Hero({ heading }) {
  return <ThemeLink label={heading} />;
}
`);
    expect(out).not.toContain("data-storefront-field=");
  });

  it("never overwrites an attribute the author wrote by hand", () => {
    // A hand-written marker exists where the analysis cannot see, so it is
    // the only thing making that element editable.
    const source = `${DECLARES}
export default function Hero({ heading }) {
  const shown = heading ?? "";
  return <h1 data-storefront-field="heading">{shown}</h1>;
}
`;
    const out = run(source);
    expect(out.match(/data-storefront-field="heading"/g)).toHaveLength(1);
  });

  it("leaves a row alone when the array is not something it can address", () => {
    const out = run(`${DECLARES}
export default function Hero({ getItems }) {
  return <ul>{getItems().map((item, i) => <li key={i}>{item.title}</li>)}</ul>;
}
`);
    expect(out).not.toContain("data-storefront-field-path");
  });

  it("keeps everything the author wrote exactly as they wrote it", () => {
    const source = `${DECLARES}
export default function Hero({ heading }) {
  // A comment they care about
  return <h1   className="a"  >{heading}</h1>;
}
`;
    const out = run(source);
    expect(out).toContain("// A comment they care about");
    expect(out).toContain('className="a"');
    // Only added text; nothing removed.
    for (const line of source.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("return <h1")) {
        expect(out).toContain(trimmed);
      }
    }
  });

  it("hands unparseable source back untouched rather than guessing", () => {
    const source = `export default function Hero() { return <h1>{ <<< }</h1>; }`;
    const result = injectPreviewBindings([
      { path: "src/components/Hero.tsx", content: source },
    ]);
    expect(result.files[0]!.content).toBe(source);
    expect(result.skipped[0]?.path).toBe("src/components/Hero.tsx");
  });

  it("touches files that are not JSX not at all", () => {
    const source = `export const value = 1;\n`;
    expect(run(source, "src/morph/content.ts")).toBe(source);
  });

  it("still produces valid syntax after everything it adds", async () => {
    const { parse } = await import("@babel/parser");
    const out = run(`${DECLARES}
export default function Hero({ heading, items = [] }) {
  return (
    <section>
      <h1>{heading}</h1>
      {items.map((item, index) => (
        <a key={item.id} href={item.title}>{item.title}</a>
      ))}
    </section>
  );
}
`);
    expect(() =>
      parse(out, { sourceType: "module", plugins: ["jsx", "typescript"] }),
    ).not.toThrow();
  });
});

describe("giving the editor a section to find", () => {
  const ROUTE = `import CategoryShowcase from "../components/CategoryShowcase";
import Hero from "../components/Hero";
import { content, isSectionHidden } from "../morph/content";

export default function HomeRoute() {
  return (
    <main>
      {!isSectionHidden("starter-hero") && <Hero {...content("starter-hero")} />}
      {!isSectionHidden("starter-categories") && (
        <CategoryShowcase {...content("starter-categories")} />
      )}
    </main>
  );
}
`;

  const runRoute = (source = ROUTE) =>
    injectPreviewBindings([{ path: "src/routes/index.tsx", content: source }]);

  it("wraps each section in something the page cannot see", () => {
    const out = runRoute().files[0]!.content;
    expect(out).toContain(
      '<div data-storefront-section-id="starter-hero" style={{ display: "contents" }}>',
    );
    expect(out).toContain(
      '<div data-storefront-section-id="starter-categories" style={{ display: "contents" }}>',
    );
    expect(out.match(/<\/div>/g)).toHaveLength(2);
  });

  it("reads the slot id from where it is actually known", () => {
    // A component cannot say which section it is — the same one can be placed
    // twice — so the answer only exists where its content is handed to it.
    expect(runRoute().sections["src/routes/index.tsx"]).toEqual([
      "starter-hero",
      "starter-categories",
    ]);
  });

  it("still produces valid syntax around a guarded section", async () => {
    const { parse } = await import("@babel/parser");
    expect(() =>
      parse(runRoute().files[0]!.content, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      }),
    ).not.toThrow();
  });

  it("says so when the spacing will differ from the build", () => {
    // `display: contents` leaves the wrapper in the tree, so a rule counting
    // children matches it instead. The symptom gives no hint of the cause.
    const warned = runRoute(
      ROUTE.replace("<main>", '<main className="space-y-8">'),
    );
    expect(warned.warnings[0]?.message).toContain("space-y");
    expect(warned.warnings[0]?.path).toBe("src/routes/index.tsx");
  });

  it("stays quiet when nothing counts children", () => {
    expect(runRoute().warnings).toEqual([]);
  });

  it("wraps nothing where no section is rendered", () => {
    const result = injectPreviewBindings([
      {
        path: "src/components/Hero.tsx",
        content: `export default function Hero() { return <h1>hi</h1>; }\n`,
      },
    ]);
    expect(result.files[0]!.content).not.toContain(
      "data-storefront-section-id",
    );
    expect(result.warnings).toEqual([]);
  });
});
