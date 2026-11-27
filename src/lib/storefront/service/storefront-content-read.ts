/**
 * The scoped reads of `/_morph/content`, beside the legacy merged read.
 *
 * Wire format (the SDK's `pages.get(path, { scope: "page" })` and
 * `layouts.get("default")`, packages/morph-sdk/README.md):
 *
 * - `?path=/x` (no `scope`): the legacy merged read, the shared layout's
 *   content with the page's laid over it. Answered exactly as before this
 *   module existed: `{ slots, hiddenSlots }`, nothing added.
 * - `?path=/x&scope=page`: the page's own Document only.
 *   Answered `{ scope: "page", slots, hiddenSlots }`.
 * - `?scope=layout&layout=default`: the shared layout Document only (today
 *   the singleton `layout` template). Answered
 *   `{ scope: "layout", layout: "default", slots, hiddenSlots }`.
 *
 * The echoed `scope` is the version marker. An answerer from before scoped
 * reads ignores the parameter and answers the merged content without it, so
 * the SDK refuses that answer (`invalid_response`) rather than reading merged
 * content as page-only or layout content. Old SDK copies in existing builds
 * never send `scope` and keep the legacy answer byte for byte.
 *
 * Every function here is self-contained, using nothing outside itself, so
 * the content servers that run outside Core (the preview Worker and dev
 * server, a build's prerender servers) embed it by source (`toString`) and
 * answer exactly as Core does.
 */

export type StorefrontContentScopedRead =
  | Readonly<{ scope: "page"; path: string }>
  | Readonly<{ scope: "layout"; layout: "default" }>;

/**
 * What a content read's query asks for: `null` for the legacy merged read
 * (no `scope` parameter; each endpoint keeps its own path handling for it),
 * a scoped read, or `"invalid"` for a scoped read that cannot be answered.
 */
export function storefrontContentScopedRead(
  params: URLSearchParams,
): StorefrontContentScopedRead | "invalid" | null {
  const scopes = params.getAll("scope");
  if (scopes.length === 0) return null;
  if (scopes.length !== 1) return "invalid";
  if (scopes[0] === "page") {
    const paths = params.getAll("path");
    const path = paths.length === 1 ? paths[0] : null;
    if (
      typeof path !== "string" ||
      path.length > 500 ||
      !path.startsWith("/") ||
      params.has("layout")
    ) {
      return "invalid";
    }
    return { scope: "page", path };
  }
  if (scopes[0] === "layout") {
    const layouts = params.getAll("layout");
    // One shared layout exists today: the singleton layout Document.
    if (
      layouts.length !== 1 ||
      layouts[0] !== "default" ||
      params.has("path")
    ) {
      return "invalid";
    }
    return { scope: "layout", layout: "default" };
  }
  return "invalid";
}

/** A scoped read's answer body: its content, naming the read it answers. */
export function storefrontContentScopedBody(
  read: StorefrontContentScopedRead,
  content: Readonly<{ slots: unknown; hiddenSlots: unknown }>,
): Record<string, unknown> {
  return read.scope === "layout"
    ? {
        scope: "layout",
        layout: read.layout,
        slots: content.slots,
        hiddenSlots: content.hiddenSlots,
      }
    : { scope: "page", slots: content.slots, hiddenSlots: content.hiddenSlots };
}

/** The refusal body Core's endpoints send for an unusable scoped read. */
export const STOREFRONT_CONTENT_INVALID_READ = "Invalid content read.";
