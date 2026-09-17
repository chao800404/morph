import { describe, expect, it } from "vitest";
import {
  didEditorContextChange,
  didRoutePathChange,
  didTemplateContextChange,
} from "./editor-context-reset";

/**
 * These pin the reset decision the editor makes on every render of the search
 * params. They are characterisation tests: they record what the two effects
 * actually do today, including the asymmetry between them, so that merging the
 * effects or resolving `templateId` to the loaded template is a visible change
 * rather than a silent one.
 *
 * The effects themselves are idempotent — clear three refs, clear the
 * selection, reset the scroll position — so "reset once" is a property of
 * repeated application, not of the number of predicates that returned true.
 */
describe("editor context reset", () => {
  describe("first mount", () => {
    it("does not reset when the refs already hold the current search values", () => {
      // Both refs are initialised from the first render's search params, so the
      // first pass compares a value against itself.
      expect(didTemplateContextChange("template-a", "template-a")).toBe(false);
      expect(didRoutePathChange("/", "/")).toBe(false);
    });
  });

  describe("templateId resolved from the template list", () => {
    it("does not reset when the URL gains the resolved template id", () => {
      expect(didTemplateContextChange(undefined, "template-a")).toBe(false);
    });

    it("does not reset while the resolved id keeps matching", () => {
      expect(didTemplateContextChange("template-a", "template-a")).toBe(false);
    });
  });

  describe("switching what is being edited", () => {
    it("resets when the template changes", () => {
      expect(didTemplateContextChange("template-a", "template-b")).toBe(true);
    });

    it("resets when the route changes", () => {
      expect(didRoutePathChange("/", "/products")).toBe(true);
    });

    it("resets when the route appears where the URL had none", () => {
      // Unlike templateId: a route is authored, so its first appearance is a
      // real move to a different page.
      expect(didRoutePathChange(undefined, "/products")).toBe(true);
    });

    it("reports both changes when template and route move together", () => {
      expect(didTemplateContextChange("template-a", "template-b")).toBe(true);
      expect(didRoutePathChange("/", "/products")).toBe(true);
    });

    it("resets once when template and route move together", () => {
      expect(
        didEditorContextChange({
          previousTemplateId: "template-a",
          nextTemplateId: "template-b",
          previousRoutePath: "/",
          nextRoutePath: "/products",
        }),
      ).toBe(true);
    });

    it("does not reset for an unchanged context", () => {
      expect(
        didEditorContextChange({
          previousTemplateId: "template-a",
          nextTemplateId: "template-a",
          previousRoutePath: "/",
          nextRoutePath: "/",
        }),
      ).toBe(false);
    });
  });

  describe("repeated renders", () => {
    it("does not reset again for an unchanged context", () => {
      expect(didTemplateContextChange("template-a", "template-a")).toBe(false);
      expect(didRoutePathChange("/products", "/products")).toBe(false);
    });
  });

  describe("the asymmetry", () => {
    it("resets when the URL drops a template id it used to carry", () => {
      // Current behaviour, recorded rather than endorsed: the decision compares
      // the URL parameter, so losing it looks like a switch even when the
      // resolved template has not moved. Resolving to the loaded template
      // instead is a deliberate change that must update this assertion and
      // explain what the old one got wrong.
      expect(didTemplateContextChange("template-a", undefined)).toBe(true);
    });
  });
});
