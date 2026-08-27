// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

function render(source: string, props: Record<string, unknown>) {
  const result = renderSafeThemeComponent({
    files: [{ path: "src/components/Widget.tsx", content: source }] as never,
    sourcePath: "src/components/Widget.tsx",
    props,
  });
  return renderToStaticMarkup(result.node as never);
}

function fieldsIn(html: string) {
  return [...html.matchAll(/data-storefront-field="([^"]*)"/g)].map((m) => m[1]);
}

describe("content field inference", () => {
  it("binds an unmarked element to the prop it renders", () => {
    // Without this an author who writes plain JSX gets a component that can be
    // selected and restyled but whose text the Inspector cannot edit.
    const html = render(
      `export default function Widget({ heading = "H", description = "D" }) {
  return (
    <section>
      <h1>{heading}</h1>
      <p>{description}</p>
    </section>
  );
}`,
      { heading: "Stored heading", description: "Stored description" },
    );

    expect(fieldsIn(html)).toEqual(["heading", "description"]);
    expect(html).toContain("Stored heading");
  });

  it("reads through a fallback so an optional prop is still editable", () => {
    const html = render(
      `export default function Widget({ heading }: { heading?: string }) {
  return <h1>{heading ?? "Untitled"}</h1>;
}`,
      { heading: "Stored" },
    );

    expect(fieldsIn(html)).toEqual(["heading"]);
  });

  it("binds an image to the prop supplying its src", () => {
    const html = render(
      `export default function Widget({ imageSrc = "/a.png" }) {
  return <img src={imageSrc} alt="" />;
}`,
      { imageSrc: "/b.png" },
    );

    expect(fieldsIn(html)).toEqual(["imageSrc"]);
  });

  it("binds a component that has never been given any values", () => {
    // A section whose values have never been stored is rendered with `{}`.
    // Validating only against the runtime props would leave it permanently
    // uneditable: the binding it needs in order to be edited would appear only
    // once it already had been.
    const html = render(
      `export default function Widget({ heading = "Default" }) {
  return <h2>{heading}</h2>;
}`,
      {},
    );

    expect(fieldsIn(html)).toEqual(["heading"]);
    expect(html).toContain("Default");
  });

  it("still ignores a local that the component does not declare", () => {
    const html = render(
      `export default function Widget({ heading = "H" }) {
  const internal = "x";
  return (
    <section>
      <h2>{heading}</h2>
      <p>{internal}</p>
    </section>
  );
}`,
      {},
    );

    expect(fieldsIn(html)).toEqual(["heading"]);
  });

  it("never invents a field for an expression that names no single prop", () => {
    // Two props in one expression cannot be written back unambiguously, and a
    // local that is not a prop is not content at all.
    const html = render(
      `export default function Widget({ first = "a", second = "b" }) {
  const local = "x";
  return (
    <section>
      <h1>{first + second}</h1>
      <p>{local}</p>
    </section>
  );
}`,
      {},
    );

    expect(fieldsIn(html)).toEqual([]);
  });

  it("keeps an authored marker authoritative over what it renders", () => {
    const html = render(
      `export default function Widget({ actionLabel = "Go", other = "x" }) {
  return <a data-morph-element="action" href="/x">{other}</a>;
}`,
      {},
    );

    expect(fieldsIn(html)).toEqual(["actionLabel"]);
  });

  it("gives every repeated item an identity without any marker", () => {
    const html = render(
      `export default function Widget({ items = [] }: { items?: any[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          <h3>{item.title}</h3>
          <p>{item.body ?? ""}</p>
        </li>
      ))}
    </ul>
  );
}`,
      { items: [{ id: "i1", title: "T1", body: "B1" }, { id: "i2", title: "T2", body: "B2" }] },
    );

    // The list element stands for the whole item; its children name the fields.
    expect(fieldsIn(html)).toEqual(["items", "title", "body", "items", "title", "body"]);
    expect(
      [...html.matchAll(/data-storefront-field-path="([^"]*)"/g)].map((m) => m[1]),
    ).toEqual([
      "items.0",
      "items.0.title",
      "items.0.body",
      "items.1",
      "items.1.title",
      "items.1.body",
    ]);
    expect(
      [...html.matchAll(/data-storefront-item-id="([^"]*)"/g)].map((m) => m[1]),
    ).toEqual(["i1", "i2"]);
  });
});
