import { describe, expect, it } from "vitest";
import { createSelectionStylePreview } from "./selection-style-preview";

function element(initialInline = "") {
  const style = new Map<string, string>();
  if (initialInline) style.set("padding", initialInline);
  return {
    style: {
      setProperty: (property: string, value: string) =>
        style.set(property, value),
      removeProperty: (property: string) => style.delete(property),
      getPropertyValue: (property: string) => style.get(property) ?? "",
      getPropertyPriority: () => "",
    },
    read: (property: string) => style.get(property) ?? null,
  } as never as HTMLElement & { read: (property: string) => string | null };
}

describe("selection style preview", () => {
  it("previews a value without persisting it", () => {
    const target = element();
    const preview = createSelectionStylePreview();

    preview.apply(target, { padding: "60px" });
    expect(target.read("padding")).toBe("60px");
  });

  it("removes the preview so the source styles take over", () => {
    // Restore hands the element back to its stylesheet rules. It must run only
    // once those rules exist, or the element briefly shows its previous value.
    const target = element();
    const preview = createSelectionStylePreview();

    preview.apply(target, { padding: "60px" });
    preview.restore();
    expect(target.read("padding")).toBeNull();
  });

  it("restores an inline value the Theme itself had authored", () => {
    const target = element("8px");
    const preview = createSelectionStylePreview();

    preview.apply(target, { padding: "60px" });
    preview.restore();
    expect(target.read("padding")).toBe("8px");
  });

  it("moves the preview between elements without stranding the first", () => {
    const first = element();
    const second = element();
    const preview = createSelectionStylePreview();

    preview.apply(first, { padding: "60px" });
    preview.apply(second, { padding: "40px" });

    expect(first.read("padding")).toBeNull();
    expect(second.read("padding")).toBe("40px");
  });

  it("ignores properties outside the previewable set", () => {
    const target = element();
    const preview = createSelectionStylePreview();

    preview.apply(target, { "pointer-events": "none" });
    expect(target.read("pointer-events")).toBeNull();
  });
});
