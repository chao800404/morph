/**
 * How a Live Preview's canvas comes to show a saved content edit
 * (docs/astro-theme-plan.md 6.5, "A6b-2").
 *
 * - `null`: the client-only preview renders from the snapshot inside the
 *   page, which the editor updates as the author types. Nothing to sync.
 * - `"router"`: Start's own server reads the snapshot it holds; once
 *   `syncThemePreviewContent` applies, the router's loaders run again.
 * - `"reload"`: a framework's dev server (Astro) renders the page from it;
 *   once the sync applies, the page is loaded again (6.3).
 */
export type PreviewContentRefresh = "router" | "reload";

/**
 * The refresh a preview started with these settings needs. The condition is
 * the one the transports use to start a Worker that names the snapshot it
 * reads — the only kind of preview that can confirm a sync at all.
 */
export function previewContentRefresh(input: {
  previewRuntime: "start" | undefined;
  /** The Theme's framework declares a dev server of its own (Astro). */
  devServer: boolean;
}): PreviewContentRefresh | null {
  if (input.devServer) return "reload";
  if (input.previewRuntime === "start") return "router";
  return null;
}
