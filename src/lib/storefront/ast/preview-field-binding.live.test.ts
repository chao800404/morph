/**
 * Which element names which content field, as the canvas renders it.
 *
 * The interpreter decided this while it evaluated a component; the real React
 * Live Preview decides it before React runs, in `injectPreviewBindings`. These
 * render the result with real React and read it back the way the editor does,
 * so what is asserted is what a click on the canvas can reach.
 *
 * The interpreter also inferred fields for props nobody declared. The preview
 * pass names declared fields only, so each component here declares what it
 * means to be editable; "a local the component does not declare" below is the
 * case that holds the difference.
 */
import { describe, expect, it } from "vitest";
import {
  mountLivePreview,
  renderLivePreviewComponent,
} from "@/lib/test-utils/live-preview-render";
import { resolveSelectable } from "@/lib/storefront/editor/preview-dom";

const PATH = "src/components/Widget.tsx";

async function render(source: string, props: Record<string, unknown> = {}) {
  const { html, prepared } = await renderLivePreviewComponent({
    files: [{ path: PATH, content: source }],
    sourcePath: PATH,
    props,
  });
  expect(prepared.bindings.skipped).toEqual([]);
  return html;
}

const fieldsIn = (html: string) =>
  [...html.matchAll(/data-storefront-field="([^"]*)"/g)].map((m) => m[1]);
const pathsIn = (html: string) =>
  [...html.matchAll(/data-storefront-field-path="([^"]*)"/g)].map((m) => m[1]);

describe("content field binding in the real React Live Preview", () => {
  it("binds an unmarked element to the declared prop it renders", async () => {
    const html = await render(
      `export const contentFields = {
  heading: { type: "text" },
  description: { type: "textarea" },
};
export default function Widget({ heading = "H", description = "D" }) {
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

  it("reads through a fallback so an optional prop is still editable", async () => {
    const html = await render(
      `export const contentFields = { heading: { type: "text" } };
export default function Widget({ heading }: { heading?: string }) {
  return <h1>{heading ?? "Untitled"}</h1>;
}`,
      { heading: "Stored" },
    );

    expect(fieldsIn(html)).toEqual(["heading"]);
  });

  it("binds an image to the prop supplying its src", async () => {
    const html = await render(
      `export const contentFields = { imageSrc: { type: "url" } };
export default function Widget({ imageSrc = "/a.png" }) {
  return <img src={imageSrc} alt="" />;
}`,
      { imageSrc: "/b.png" },
    );

    expect(fieldsIn(html)).toEqual(["imageSrc"]);
  });

  it("binds an anchor to the prop supplying its href", async () => {
    const html = await render(
      `export const contentFields = { actionHref: { type: "url" } };
export default function Widget({ actionHref = "/a" }) {
  return <a href={actionHref}>Go</a>;
}`,
      { actionHref: "/b" },
    );

    expect(fieldsIn(html)).toEqual(["actionHref"]);
  });

  it("binds a router Link to the prop supplying its destination", async () => {
    const html = await render(
      `import { Link } from "@tanstack/react-router";
export const contentFields = { actionHref: { type: "url" } };
export default function Widget({ actionHref = "/a" }) {
  return <Link to={actionHref}>Go</Link>;
}`,
      { actionHref: "/b" },
    );

    expect(fieldsIn(html)).toEqual(["actionHref"]);
    expect(html).toContain('href="/b"');
  });

  it("infers nothing when the destination is written as a literal", async () => {
    const html = await render(
      `import { Link } from "@tanstack/react-router";
export const contentFields = { actionHref: { type: "url" } };
export default function Widget({ actionHref = "/a" }) {
  return <Link to="/aboutus">Go</Link>;
}`,
      { actionHref: "/b" },
    );

    expect(fieldsIn(html)).toEqual([]);
  });

  it("binds a component that has never been given any values", async () => {
    const html = await render(
      `export const contentFields = { heading: { type: "text" } };
export default function Widget({ heading = "Default" }) {
  return <h2>{heading}</h2>;
}`,
    );

    expect(fieldsIn(html)).toEqual(["heading"]);
    expect(html).toContain("Default");
  });

  it("ignores a prop or local the component does not declare", async () => {
    const html = await render(
      `export const contentFields = { heading: { type: "text" } };
export default function Widget({ heading = "H", subtitle = "S" }) {
  const internal = "x";
  return (
    <section>
      <h2>{heading}</h2>
      <h3>{subtitle}</h3>
      <p>{internal}</p>
    </section>
  );
}`,
    );

    expect(fieldsIn(html)).toEqual(["heading"]);
  });

  it("never invents a field for an expression that names no single prop", async () => {
    const html = await render(
      `export const contentFields = {
  first: { type: "text" },
  second: { type: "text" },
};
export default function Widget({ first = "a", second = "b" }) {
  return <h1>{first + second}</h1>;
}`,
    );

    expect(fieldsIn(html)).toEqual([]);
  });

  /** The field a click on the component's only `<p>` would edit. */
  async function clickedField(source: string) {
    const root = mountLivePreview(await render(source));
    return resolveSelectable(root.querySelector("p"))?.fieldKey ?? null;
  }
  const TWO_FIELDS = `export const contentFields = {
  title: { type: "text" },
  description: { type: "text" },
};`;

  it("binds what the element renders, not the name a semantic marker gives it", async () => {
    // `data-morph-element` says what an element means; it is never required
    // and never decides where an edit is stored (rule 02 §5.3.1, §8.5). The
    // interpreter let it win, which stored an edit of the shown description
    // as `title`.
    expect(
      await clickedField(`${TWO_FIELDS}
export default function Widget({ title = "T", description = "D" }) {
  return <p data-morph-element="title">{description}</p>;
}`),
    ).toBe("description");
  });

  // KNOWN GAP, found while porting this file. A hand-written
  // `data-storefront-field` is kept as written ("never overwrites an attribute
  // the author wrote"), so an element that shows `{description}` but is
  // marked `title` sends edits to `title`. Where the marker and the provable
  // source disagree, or the source cannot be proven, the content write has
  // to stop rather than follow the marker. `it.fails` until it does.
  it.fails(
    "does not edit the field a hand-written marker names when the element renders another",
    async () => {
      expect(
        await clickedField(`${TWO_FIELDS}
export default function Widget({ title = "T", description = "D" }) {
  return <p data-storefront-field="title">{description}</p>;
}`),
      ).not.toBe("title");
    },
  );

  it.fails(
    "does not edit the field a hand-written marker names when the source cannot be proven",
    async () => {
      expect(
        await clickedField(`export const contentFields = { title: { type: "text" } };
export default function Widget({ title = "T" }) {
  const shown = "x" + title;
  return <p data-storefront-field="title">{shown}</p>;
}`),
      ).toBeNull();
    },
  );

  it("gives every repeated item an identity without any marker", async () => {
    const html = await render(
      `export const contentFields = {
  items: {
    type: "array",
    fields: { title: { type: "text" }, body: { type: "textarea" } },
  },
};
export default function Widget({ items = [] }: { items?: any[] }) {
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
      {
        items: [
          { id: "i1", title: "T1", body: "B1" },
          { id: "i2", title: "T2", body: "B2" },
        ],
      },
    );

    expect(pathsIn(html)).toEqual([
      "items.0",
      "items.0.title",
      "items.0.body",
      "items.1",
      "items.1.title",
      "items.1.body",
    ]);
    expect([
      ...new Set(
        [...html.matchAll(/data-storefront-item-id="([^"]*)"/g)].map(
          (m) => m[1],
        ),
      ),
    ]).toEqual(["i1", "i2"]);
  });
});

describe("a member chain off a repeated row, in the real React Live Preview", () => {
  async function pathsFor(body: string) {
    return pathsIn(
      await render(
        `export const contentFields = {
  rows: {
    type: "array",
    label: "Rows",
    fields: {
      title: { type: "text", label: "Title" },
      image: { type: "image", label: "Image" },
    },
  },
} as const;

export default function Widget({ rows = [] }: { rows?: any[] }) {
  return (
    <section>
      {rows.map((row, index) => (
        <div key={index}>${body}</div>
      ))}
    </section>
  );
}`,
        {
          rows: [
            {
              title: "A",
              image: { src: "/a.png", alt: "a" },
              imageSrc: "/legacy.png",
            },
          ],
        },
      ),
    );
  }

  it("reads a direct field", async () => {
    expect(await pathsFor("<p>{row.title}</p>")).toContain("rows.0.title");
  });

  it("reads through a nested value", async () => {
    expect(await pathsFor('<img src={row.image.src} alt="" />')).toContain(
      "rows.0.image",
    );
  });

  it("reads through optional chaining", async () => {
    expect(await pathsFor('<img src={row.image?.src} alt="" />')).toContain(
      "rows.0.image",
    );
  });

  it("reads the first branch of a fallback chain", async () => {
    expect(
      await pathsFor(
        '<img key={index} src={row.image?.src ?? row.imageSrc ?? "/d.png"} alt="" />',
      ),
    ).toContain("rows.0.image");
  });

  it("refuses a computed step, which names nothing it can see", async () => {
    expect(await pathsFor('<p>{row["ti" + "tle"]}</p>')).not.toContain(
      "rows.0.title",
    );
  });
});
