import { describe, expect, it } from "vitest";
import { parseColocatedContentFields } from "./theme-content-fields-source";

describe("parseColocatedContentFields", () => {
  it("reads a component's own field declaration", () => {
    const result = parseColocatedContentFields(`
export const contentFields = {
  title: { type: "text", label: "Title" },
  body: { type: "textarea", maxLength: 500 },
  link: { type: "url", label: "Link" },
} as const;

export default function Promo({ title = "Hi" }) {
  return <section>{title}</section>;
}
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.fields).toEqual({
      title: { type: "text", label: "Title" },
      body: { type: "textarea", maxLength: 500 },
      link: { type: "url", label: "Link" },
    });
  });

  it("supports select options and boolean or number fields", () => {
    const result = parseColocatedContentFields(`
export const contentFields = {
  align: {
    type: "select",
    options: [
      { label: "Left", value: "left" },
      { label: "Right", value: "right" },
    ],
  },
  columns: { type: "number" },
  compact: { type: "boolean" },
};
`);
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.fields ?? {}).sort()).toEqual([
      "align",
      "columns",
      "compact",
    ]);
  });

  it("returns nothing for a component that declares no fields", () => {
    const result = parseColocatedContentFields(
      "export default function Plain() { return <div />; }",
    );
    expect(result.fields).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it("refuses a declaration that is not statically analysable", () => {
    // The editor has to render the form before the Theme ever runs, so a
    // computed declaration cannot be understood and must not half-work.
    const result = parseColocatedContentFields(`
const label = getLabel();
export const contentFields = { title: { type: "text", label } };
`);
    expect(result.fields).toBeNull();
    expect(result.diagnostics[0]).toContain("static object literal");
  });

  it("drops an invalid field without discarding the valid ones", () => {
    const result = parseColocatedContentFields(`
export const contentFields = {
  good: { type: "text" },
  bad: { type: "not-a-real-type" },
};
`);
    expect(result.fields).toEqual({ good: { type: "text" } });
    expect(result.diagnostics.join()).toContain('"bad"');
  });

  it("rejects field names that are not safe identifiers", () => {
    const result = parseColocatedContentFields(`
export const contentFields = { "9bad": { type: "text" }, "ok": { type: "text" } };
`);
    expect(Object.keys(result.fields ?? {})).toEqual(["ok"]);
    expect(result.diagnostics.join()).toContain("9bad");
  });

  it("ignores a non-exported declaration", () => {
    const result = parseColocatedContentFields(`
const contentFields = { title: { type: "text" } };
export default function X() { return null; }
`);
    expect(result.fields).toBeNull();
  });

  it("reports unparseable source instead of throwing", () => {
    const result = parseColocatedContentFields(
      "export const contentFields = { title: { type: 'text' } ;;;",
    );
    expect(result.fields).toBeNull();
    expect(result.diagnostics[0]).toContain("Could not parse");
  });

  it("does not parse files that cannot contain a declaration", () => {
    const result = parseColocatedContentFields(
      "export default function X() { return <div className='a' />; }",
    );
    expect(result.fields).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });
});
