// @vitest-environment node
/**
 * Which expression shapes the field inference can follow.
 *
 * It has to cover what a component author actually writes, because every shape
 * it cannot read becomes an identity marker somebody has to add by hand — and
 * the rule is that nobody should have to.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

function fieldsFor(body: string) {
  const source = `export const contentFields = {
  rows: {
    type: "array",
    label: "Rows",
    fields: {
      title: { type: "text", label: "Title" },
      image: { type: "image", label: "Image" },
    },
  },
} as const;

export default function Probe({ rows = [] }) {
  return (\n    <section>\n      {rows.map((row, index) => (\n        <div key={index}>${body}</div>\n      ))}\n    </section>\n  );
}`;
  const result = renderSafeThemeComponent({
    files: [{ path: "src/components/Probe.tsx", content: source }],
    sourcePath: "src/components/Probe.tsx",
    props: {
      rows: [
        {
          title: "A",
          image: { src: "/a.png", alt: "a" },
          imageSrc: "/legacy.png",
        },
      ],
    },
  } as never) as { success: boolean; node: unknown; diagnostics: string[] };
  expect(result.success, result.diagnostics?.join("; ")).toBe(true);
  const markup = renderToStaticMarkup(result.node as never);
  return [...markup.matchAll(/data-storefront-field-path="([^"]*)"/g)].map(
    (m) => m[1],
  );
}

describe("a member chain off a repeated row", () => {
  it("reads a direct field", () => {
    expect(fieldsFor("<p>{row.title}</p>")).toContain("rows.0.title");
  });

  it("reads through a nested value", () => {
    // The field is `image`; `.src` is reaching inside what it holds.
    expect(fieldsFor('<img src={row.image.src} alt="" />')).toContain(
      "rows.0.image",
    );
  });

  it("reads through optional chaining", () => {
    expect(fieldsFor('<img src={row.image?.src} alt="" />')).toContain(
      "rows.0.image",
    );
  });

  it("reads the first branch of a fallback chain", () => {
    // What a component writes while a flat prop is still being migrated.
    expect(
      fieldsFor(
        '<img key={index} src={row.image?.src ?? row.imageSrc ?? "/d.png"} alt="" />',
      ),
    ).toContain("rows.0.image");
  });

  it("refuses a computed step, which names nothing it can see", () => {
    // `row[key]` depends on a value the inference cannot know, and guessing
    // would bind the element to whichever field was guessed.
    expect(fieldsFor('<p>{row["ti" + "tle"]}</p>')).not.toContain(
      "rows.0.title",
    );
  });
});
