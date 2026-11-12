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

  // Task 41 R3-2: the shell's checks live in the one rule too.
  it("has none for a hidden section or a section another page owns", () => {
    const at = (extra: { sectionHidden?: boolean; ownedHere?: boolean }) =>
      listOwnDiscardLabel({
        contentStore: "document",
        fields,
        propsSetInCode: null,
        fieldPath: "items",
        ...extra,
      });
    expect(at({ sectionHidden: true })).toBeNull();
    expect(at({ ownedHere: false })).toBeNull();
    // A section of the page's layout document is owned by the page too: the
    // caller says so (`ownedHere`), and the list keeps its own control.
    expect(at({ ownedHere: true, sectionHidden: false })).toBe("Entries");
  });

  // Task 41 R3-3: the panel draws a list whose row shape never resolved as
  // "cannot be edited", with no card and so no discard of its own: Discard
  // mine is its exit.
  it("has none for a declared list whose row shape is unresolved", () => {
    expect(
      listOwnDiscardLabel({
        contentStore: "document",
        fields: { items: { type: "array", label: "Cards" } } as never,
        propsSetInCode: null,
        fieldPath: "items",
      }),
    ).toBeNull();
  });

  it("reads what the page's code sets as the Content panel does", () => {
    // No route source and no layout: nothing is set in code.
    expect(slotPropsSetInCode([], null, "hero")).toBeNull();
    // A route source the workspace does not hold fails closed.
    expect(slotPropsSetInCode([], "src/routes/index.tsx", "hero")).toBe("any");
  });
});
