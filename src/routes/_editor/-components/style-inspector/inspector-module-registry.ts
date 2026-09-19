import type { ReactNode } from "react";
import type { InspectorModuleId } from "@/lib/storefront/editor/inspector-modules";

/**
 * Modules rendered inside the Design card.  Content, source-style and the
 * advanced capability cards intentionally remain outside this registry.
 * Keeping this list typed prevents a renderer from silently drifting away
 * from the domain capability resolver.
 */
export type InspectorDesignModuleId = Extract<
  InspectorModuleId,
  | "layout"
  | "sizing"
  | "position"
  | "appearance"
  | "spacing"
  | "typography"
  | "fill"
  | "border"
  // Added last, and the reason is worth keeping: the resolver has put
  // `effects` on every selection since it was written, while this list — the
  // one that decides what is rendered — did not have it. The comment above
  // says this typing exists so a renderer cannot drift from the resolver, and
  // it was doing that job: the drift was real, it just had nobody reading the
  // difference. `interaction` and `accessibility` are still outside, and still
  // resolved.
  | "effects"
  | "interaction"
>;

export type InspectorModuleDescriptor = {
  readonly id: InspectorDesignModuleId;
  readonly stateKey:
    | "flow"
    | "sizing"
    | "position"
    | "appearance"
    | "layout"
    | "typography"
    | "fills"
    | "borders"
    | "effects"
    | "interaction";
};

export const INSPECTOR_DESIGN_MODULE_REGISTRY = {
  layout: { id: "layout", stateKey: "flow" },
  sizing: { id: "sizing", stateKey: "sizing" },
  position: { id: "position", stateKey: "position" },
  appearance: { id: "appearance", stateKey: "appearance" },
  spacing: { id: "spacing", stateKey: "layout" },
  typography: { id: "typography", stateKey: "typography" },
  fill: { id: "fill", stateKey: "fills" },
  border: { id: "border", stateKey: "borders" },
  effects: { id: "effects", stateKey: "effects" },
  interaction: { id: "interaction", stateKey: "interaction" },
} satisfies Record<InspectorDesignModuleId, InspectorModuleDescriptor>;

export const INSPECTOR_DESIGN_MODULE_ORDER = [
  "layout",
  "sizing",
  "position",
  "appearance",
  "spacing",
  "typography",
  "fill",
  "border",
  "effects",
  "interaction",
] as const satisfies readonly InspectorDesignModuleId[];

/**
 * Single capability-to-render boundary for the Design card.  The callback
 * remains owned by the Inspector so existing preview/commit closures and
 * lazy card content are preserved without duplicating state or UI cards.
 */
export function renderInspectorDesignModule(
  id: InspectorDesignModuleId,
  visibleModules: ReadonlySet<InspectorModuleId>,
  render: () => ReactNode,
): ReactNode {
  if (!visibleModules.has(id)) return null;
  return render();
}

export function hasInspectorDesignModule(
  visibleModules: ReadonlySet<InspectorModuleId>,
): boolean {
  return INSPECTOR_DESIGN_MODULE_ORDER.some((id) => visibleModules.has(id));
}
