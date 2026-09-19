import { describe, expect, it, vi } from "vitest";
import {
  INSPECTOR_MODULE_IDS,
  type InspectorModuleId,
} from "@/lib/storefront/editor/inspector-modules";
import {
  hasInspectorDesignModule,
  INSPECTOR_DESIGN_MODULE_ORDER,
  INSPECTOR_DESIGN_MODULE_REGISTRY,
  renderInspectorDesignModule,
} from "./inspector-module-registry";

describe("inspector design module registry", () => {
/**
 * Modules the Inspector renders itself, outside the Design card.
 *
 * `content` and `media` are capability cards with their own layout, and
 * `source-style` is the raw class panel. They are rendered — just not from the
 * registry — so they are named here rather than counted as missing.
 */
const RENDERED_OUTSIDE_THE_DESIGN_CARD: readonly InspectorModuleId[] = [
  "content",
  "media",
  "source-style",
];

/**
 * Resolved on matching selections and rendered nowhere, with the reason.
 *
 * Every entry here is a decision the capability resolver makes on every click
 * and nothing acts on. The list is meant to reach zero; until it does, it is
 * the honest count, and the test below is what keeps it honest — a new module
 * that nobody wires up fails rather than joining a comment.
 */
const RESOLVED_BUT_NOT_RENDERED: Readonly<Record<string, string>> = {
  accessibility:
    "Its controls write source attributes — aria-label, role — and no patch " +
    "function writes an attribute: the AST layer can set a className, a " +
    "component default prop and a link element, and nothing else. `alt` is " +
    "not its business either; that is a content field the media path already " +
    "owns through commitImageAlt. Needs an attribute write path, or removal " +
    "from the resolver.",
};

/**
 * The count, kept by the suite instead of by a comment.
 *
 * The registry's own documentation says its typing exists so a renderer cannot
 * drift from the capability resolver, and it was right that it could — but
 * nothing read the difference, so `effects` and `interaction` sat resolved and
 * unrendered for as long as they existed. A comment recording which ones were
 * outstanding is the kind of thing that survives the fix.
 */
it("accounts for every module the resolver can decide on", () => {
  const rendered = new Set<string>([
    ...Object.keys(INSPECTOR_DESIGN_MODULE_REGISTRY),
    ...RENDERED_OUTSIDE_THE_DESIGN_CARD,
  ]);

  const unaccounted = INSPECTOR_MODULE_IDS.filter(
    (id) => !rendered.has(id) && !(id in RESOLVED_BUT_NOT_RENDERED),
  );

  expect(
    unaccounted,
    "a module the resolver can enable is rendered nowhere and is not listed as such",
  ).toEqual([]);
});

it("keeps the not-rendered list from outliving the gap", () => {
  const stale = Object.keys(RESOLVED_BUT_NOT_RENDERED).filter(
    (id) =>
      id in INSPECTOR_DESIGN_MODULE_REGISTRY ||
      RENDERED_OUTSIDE_THE_DESIGN_CARD.includes(id as InspectorModuleId),
  );

  expect(
    stale,
    "a module is listed as not rendered while something renders it",
  ).toEqual([]);
});

  it("keeps every ordered module backed by a typed descriptor", () => {
    expect(Object.keys(INSPECTOR_DESIGN_MODULE_REGISTRY)).toEqual(
      INSPECTOR_DESIGN_MODULE_ORDER,
    );
  });

  it("renders only capabilities enabled for the selected DOM node", () => {
    const render = vi.fn(() => "Typography controls");
    const visible = new Set<InspectorModuleId>(["content", "typography"]);

    expect(hasInspectorDesignModule(visible)).toBe(true);
    expect(renderInspectorDesignModule("typography", visible, render)).toBe(
      "Typography controls",
    );
    expect(renderInspectorDesignModule("border", visible, render)).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("does not create an empty Design card for special-only capabilities", () => {
    expect(
      hasInspectorDesignModule(
        new Set<InspectorModuleId>(["content", "source-style"]),
      ),
    ).toBe(false);
  });
});
