import { describe, expect, it } from "vitest";
import { patchElementClassNameResult } from "./theme-ast-transformer";

describe("theme-ast-cn-patch", () => {
  it("patches className with JSX string literal", () => {
    const code = `
      export default function Banner() {
        return (
          <div
            data-morph-element="banner"
            className={"bg-blue-500 text-white"}
          >
            Banner
          </div>
        );
      }
    `;
    const res = patchElementClassNameResult(code, "banner", (prev) =>
      prev.replace("bg-blue-500", "bg-emerald-600"),
    );
    expect(res.editable).toBe(true);
    expect(res.code).toContain('className={"bg-emerald-600 text-white"}');
  });

  it("patches static cn(...) call expression without dynamic-classname failure", () => {
    const code = `
      export default function Button() {
        return (
          <button
            data-morph-element="action"
            className={cn("px-4 py-2 font-medium bg-primary text-primary-foreground")}
          >
            Click me
          </button>
        );
      }
    `;
    const res = patchElementClassNameResult(
      code,
      "action",
      (prev) => `${prev} rounded-lg`,
    );
    expect(res.editable).toBe(true);
    expect(res.code).toContain(
      'className={cn("px-4 py-2 font-medium bg-primary text-primary-foreground rounded-lg")}',
    );
  });

  it("edits the static classes beside a conditional, leaving the logic alone", () => {
    // The case that sent authors to Code mode for a font size. The condition
    // is the component's, and stays exactly as written; the literal beside it
    // is ordinary styling and belongs to the panel.
    const code = `
      export default function DynamicCard() {
        return (
          <div
            data-morph-element="card"
            className={cn("p-4", isSelected && "ring-2 ring-blue-500")}
          >
            Content
          </div>
        );
      }
    `;
    const res = patchElementClassNameResult(code, "card", (prev) =>
      prev.replace("p-4", "p-8"),
    );

    expect(res.editable).toBe(true);
    expect(res.code).toContain(
      'className={cn("p-8", isSelected && "ring-2 ring-blue-500")}',
    );
  });

  it("shows only the classes it can actually write", () => {
    // The conditional half is not offered as current classes: it may not be
    // applied, and nothing the panel writes could honour that.
    const code = `
      export default function Card() {
        return <div data-morph-element="card" className={cn("p-4", on && "hidden")} />;
      }
    `;
    let seen = "";
    patchElementClassNameResult(code, "card", (prev) => {
      seen = prev;
      return prev;
    });

    expect(seen).toBe("p-4");
  });

  it("collapses a run of literals instead of duplicating them", () => {
    // The panel showed these joined but wrote the result into the first
    // argument alone, so every later literal came back twice:
    // cn("p-4", "bg-white") became cn("p-4 bg-white rounded", "bg-white").
    const code = `
      export default function Card() {
        return <div data-morph-element="card" className={cn("p-4", "bg-white")} />;
      }
    `;
    const res = patchElementClassNameResult(
      code,
      "card",
      (prev) => `${prev} rounded`,
    );

    expect(res.editable).toBe(true);
    expect(res.code).toContain('className={cn("p-4 bg-white rounded")}');
  });

  it("refuses a call with no leading literal to own", () => {
    // Nothing here is the panel's: picking a branch of a ternary, or writing
    // into a template literal, would be the panel deciding the component's
    // logic for it.
    for (const attribute of [
      'className={cn(base, "p-4")}',
      'className={active ? "p-4" : "p-8"}',
      "className={`p-4 ${tone}`}",
    ]) {
      const code = `export default function C() { return <div data-morph-element="t" ${attribute} />; }`;
      const res = patchElementClassNameResult(
        code,
        "t",
        (prev) => `${prev} rounded`,
      );

      expect(res.editable, attribute).toBe(false);
      expect(res.reason, attribute).toBe("dynamic-classname");
    }
  });
});
