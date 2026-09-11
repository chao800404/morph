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

  it("still preserves dynamic-classname rejection when cn() contains conditional logic", () => {
    const dynamicCode = `
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
    const res = patchElementClassNameResult(dynamicCode, "card", (prev) =>
      prev.replace("p-4", "p-8"),
    );
    expect(res.editable).toBe(false);
    expect(res.reason).toBe("dynamic-classname");
  });
});
