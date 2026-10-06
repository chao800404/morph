// @vitest-environment node
/**
 * Row fields declared in a sibling `<Name>.fields.ts`.
 *
 * The interpreter has to answer with the declaration the editor uses, or a
 * field the Inspector offers is one the canvas can never select.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

const WITH_IMAGE = `export const contentFields = {
  rows: {
    type: "array",
    label: "Rows",
    fields: {
      title: { type: "text", label: "Title" },
      image: { type: "image", label: "Image" },
    },
  },
} as const;
`;

const TITLE_ONLY = `export const contentFields = {
  rows: {
    type: "array",
    label: "Rows",
    fields: {
      title: { type: "text", label: "Title" },
    },
  },
} as const;
`;

const COMPONENT = `export default function Probe({ rows = [] }) {
  return (
    <section>
      {rows.map((row, index) => (
        <div key={index}>
          <p>{row.title}</p>
          <img src={row.image?.src} alt="" />
        </div>
      ))}
    </section>
  );
}`;

/** Field paths the preview marks, for a row written before `image` existed. */
function fieldPaths(files: { path: string; content: string }[]) {
  const result = renderSafeThemeComponent({
    files,
    sourcePath: "src/components/Probe.tsx",
    props: { rows: [{ title: "A" }] },
  });
  expect(result.success, result.diagnostics.join("; ")).toBe(true);
  const markup = renderToStaticMarkup(result.node as never);
  return [...markup.matchAll(/data-storefront-field-path="([^"]*)"/g)].map(
    (match) => match[1],
  );
}

describe("row fields from a sibling .fields.ts", () => {
  it("reaches a field the sibling declares in a row that lacks the key", () => {
    const paths = fieldPaths([
      { path: "src/components/Probe.tsx", content: COMPONENT },
      { path: "src/components/Probe.fields.ts", content: WITH_IMAGE },
    ]);
    expect(paths).toContain("rows.0.title");
    expect(paths).toContain("rows.0.image");
  });

  it("uses a declaration that matches in both files", () => {
    const paths = fieldPaths([
      { path: "src/components/Probe.tsx", content: WITH_IMAGE + COMPONENT },
      { path: "src/components/Probe.fields.ts", content: WITH_IMAGE },
    ]);
    expect(paths).toContain("rows.0.image");
  });

  it("offers nothing from either declaration when they differ", () => {
    // The component alone would offer `image`; the sibling alone would too.
    // Neither is in effect, so a row only shows the keys it carries.
    const paths = fieldPaths([
      { path: "src/components/Probe.tsx", content: WITH_IMAGE + COMPONENT },
      { path: "src/components/Probe.fields.ts", content: TITLE_ONLY },
    ]);
    expect(paths).toContain("rows.0.title");
    expect(paths).not.toContain("rows.0.image");
  });

  it("does not run a sibling it cannot read statically", () => {
    const paths = fieldPaths([
      { path: "src/components/Probe.tsx", content: COMPONENT },
      {
        path: "src/components/Probe.fields.ts",
        content: "export const contentFields = makeFields();\n",
      },
    ]);
    expect(paths).not.toContain("rows.0.image");
  });
});

describe("row fields declared in the component", () => {
  it("still reaches a declared field with no sibling", () => {
    const paths = fieldPaths([
      { path: "src/components/Probe.tsx", content: WITH_IMAGE + COMPONENT },
    ]);
    expect(paths).toContain("rows.0.title");
    expect(paths).toContain("rows.0.image");
  });

  it("still falls back to the row's own keys with no declaration", () => {
    const paths = fieldPaths([
      { path: "src/components/Probe.tsx", content: COMPONENT },
    ]);
    expect(paths).toContain("rows.0.title");
    expect(paths).not.toContain("rows.0.image");
  });
});
