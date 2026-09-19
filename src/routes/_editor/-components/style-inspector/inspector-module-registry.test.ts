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
   * Empty, and that is the point of it. It held `accessibility` for as long as
   * the resolver could enable a module nothing rendered; that id has since been
   * removed from the vocabulary rather than given a card, because its controls
   * write JSX attributes and no attribute write path exists — see
   * `resolveInspectorModules`, where the reason and the work it waits on are
   * recorded.
   *
   * It stays because the next gap should have to be declared here, in the open,
   * instead of being discovered later by counting. An entry costs a name and a
   * reason; not having anywhere to put one costs nothing and hides everything.
   */
  const RESOLVED_BUT_NOT_RENDERED: Readonly<Record<string, string>> = {};

  /**
   * Declared and rendered are the same set, checked in both directions.
   *
   * The registry's typing exists so a renderer cannot drift from the capability
   * resolver, and it was right that it could — but nothing read the difference,
   * so `effects` and `interaction` sat resolved and unrendered for as long as
   * they existed, recorded in a comment that had outlived its own fix.
   *
   * Both directions, because each catches a different mistake. A declared id
   * nobody renders is a control the Inspector promises and does not have. A
   * rendered id the vocabulary does not declare is the reverse — a card the
   * resolver can never switch on — which is exactly what removing a word from
   * `INSPECTOR_MODULE_IDS` would leave behind if its card were forgotten.
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

  it("renders nothing the resolver cannot enable", () => {
    const declared = new Set<string>(INSPECTOR_MODULE_IDS);

    const orphaned = [
      ...Object.keys(INSPECTOR_DESIGN_MODULE_REGISTRY),
      ...RENDERED_OUTSIDE_THE_DESIGN_CARD,
    ].filter((id) => !declared.has(id));

    expect(
      orphaned,
      "something renders a module the resolver has no word for",
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
