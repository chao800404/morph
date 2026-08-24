export type InspectorBreakpointLabel = "Base" | "md" | "lg";

export function inspectorBreakpointLabel(
  viewport: "desktop" | "tablet" | "mobile",
): InspectorBreakpointLabel {
  return viewport === "desktop" ? "lg" : viewport === "tablet" ? "md" : "Base";
}

export function InspectorBreakpointIndicator({
  viewport,
}: {
  viewport: "desktop" | "tablet" | "mobile";
}) {
  const label = inspectorBreakpointLabel(viewport);

  return (
    <span
      data-slot="inspector-breakpoint-indicator"
      aria-label={`Editing ${label} breakpoint styles`}
      title={`Editing ${label} breakpoint styles`}
      className="absolute top-2 right-3 z-10 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
    >
      {label}
    </span>
  );
}
