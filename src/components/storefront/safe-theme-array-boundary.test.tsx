// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

const card = (body: string) => ({
  path: "src/components/Card.tsx",
  content: body,
});

function render(list: string, cardSource: string, items: unknown[]) {
  const result = renderSafeThemeComponent({
    files: [
      { path: "src/components/List.tsx", content: list },
      card(cardSource),
    ] as never,
    sourcePath: "src/components/List.tsx",
    props: { items },
  });
  expect(result.diagnostics).toEqual([]);
  return renderToStaticMarkup(result.node as never);
}

const attrs = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

const rows = [
  { id: "r1", title: "First" },
  { id: "r2", title: "Second" },
];

describe("repeated rows extracted into their own component", () => {
  it("keeps each row's identity across the component boundary", () => {
    // The row context lives in the interpreter environment, and an imported
    // component is evaluated against its own module environment. Without
    // carrying it across, every row claims the same field and editing one
    // would edit all of them.
    const html = render(
      `import Card from "./Card";
export default function List({ items = [] }: { items?: any[] }) {
  return <ul>{items.map((item, i) => (<Card key={i} {...item} />))}</ul>;
}`,
      `export default function Card({ title = "" }: { title?: string }) {
  return <li><h3>{title}</h3></li>;
}`,
      rows,
    );

    expect(attrs(html, "data-storefront-item-id")).toEqual(["r1", "r2"]);
    expect(attrs(html, "data-storefront-field-path")).toEqual([
      "items.0",
      "items.0.title",
      "items.1",
      "items.1.title",
    ]);
  });

  it("follows a prop the parent renamed back to the row field it came from", () => {
    const html = render(
      `import Card from "./Card";
export default function List({ items = [] }: { items?: any[] }) {
  return <ul>{items.map((item, i) => (<Card key={i} heading={item.title} />))}</ul>;
}`,
      `export default function Card({ heading = "" }: { heading?: string }) {
  return <li><h3>{heading}</h3></li>;
}`,
      rows,
    );

    // The element edits items.N.title even though the child calls it heading.
    expect(attrs(html, "data-storefront-field-path")).toEqual([
      "items.0",
      "items.0.title",
      "items.1",
      "items.1.title",
    ]);
    expect(attrs(html, "data-storefront-field")).toEqual([
      "items",
      "title",
      "items",
      "title",
    ]);
  });

  it("leaves a component rendered outside any row unmapped", () => {
    // Rendered once, not from a list: it must not inherit row paths from an
    // earlier render or claim to edit a row that does not exist.
    const html = render(
      `import Card from "./Card";
export default function List({ items = [] }: { items?: any[] }) {
  return (
    <div>
      <Card title="standalone" />
      <ul>{items.map((item, i) => (<Card key={i} {...item} />))}</ul>
    </div>
  );
}`,
      `export default function Card({ title = "" }: { title?: string }) {
  return <li><h3>{title}</h3></li>;
}`,
      rows,
    );

    expect(attrs(html, "data-storefront-item-id")).toEqual(["r1", "r2"]);
    expect(attrs(html, "data-storefront-field-path")).toEqual([
      "items.0",
      "items.0.title",
      "items.1",
      "items.1.title",
    ]);
  });

  it("still resolves rows rendered inline in the same file", () => {
    // The declaration style that exists today must keep working unchanged.
    const html = render(
      `export default function List({ items = [] }: { items?: any[] }) {
  return <ul>{items.map((item, i) => (<li key={i}><h3>{item.title}</h3></li>))}</ul>;
}`,
      `export default function Card() { return null; }`,
      rows,
    );

    expect(attrs(html, "data-storefront-item-id")).toEqual(["r1", "r2"]);
    expect(attrs(html, "data-storefront-field-path")).toEqual([
      "items.0",
      "items.0.title",
      "items.1",
      "items.1.title",
    ]);
  });
});
