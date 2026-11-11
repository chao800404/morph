import { describe, expect, it } from "vitest";
import {
  listOwnDiscardLabel,
  slotPropsSetInCode,
} from "./list-discard-control";

/**
 * Task 41 R2-2: one answer, for the Content panel and the shell alike, to
 * whether a held list has a discard control of its own. Where it has none,
 * the shell offers "Discard mine…" instead, so every message names an exit
 * that exists.
 */
describe("whether a list has its own discard control", () => {
  const fields = {
    items: { type: "array", label: "Entries", fields: {} },
    gallery: { type: "array", fields: {} },
    heading: { type: "text", label: "Heading" },
  } as never;

  it("names a declared list of a stored section by its label", () => {
    expect(
      listOwnDiscardLabel({
        contentStore: "document",
        fields,
        propsSetInCode: null,
        fieldPath: "items",
      }),
    ).toBe("Entries");
    expect(
      listOwnDiscardLabel({
        contentStore: "document",
        fields,
        propsSetInCode: new Set(["heading"]),
        fieldPath: "gallery",
      }),
    ).toBe("gallery");
  });

  it("has none for a list the page's code sets", () => {
    for (const propsSetInCode of [new Set(["items"]), "any" as const]) {
      expect(
        listOwnDiscardLabel({
          contentStore: "document",
          fields,
          propsSetInCode,
          fieldPath: "items",
        }),
      ).toBeNull();
    }
  });

  it("has none for an undeclared list, a non-list, or source mode", () => {
    const at = (fieldPath: string, contentStore: "document" | "source") =>
      listOwnDiscardLabel({
        contentStore,
        fields,
        propsSetInCode: null,
        fieldPath,
      });
    expect(at("related", "document")).toBeNull();
    expect(at("heading", "document")).toBeNull();
    expect(at("items", "source")).toBeNull();
  });

  it("reads what the page's code sets as the Content panel does", () => {
    // No route source and no layout: nothing is set in code.
    expect(slotPropsSetInCode([], null, "hero")).toBeNull();
    // A route source the workspace does not hold fails closed.
    expect(slotPropsSetInCode([], "src/routes/index.tsx", "hero")).toBe("any");
  });
});
