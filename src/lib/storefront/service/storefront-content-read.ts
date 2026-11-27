/**
 * The scoped reads of `/_morph/content`, beside the legacy merged read.
 *
 * Wire format (the SDK's `pages.get(path, { scope: "page" })` and
 * `layouts.get("default", { path })`, packages/morph-sdk/README.md):
 *
 * - `?path=/x` (no `scope`): the legacy merged read, the shared layout's
 *   content with the page's laid over it. Answered exactly as before this
 *   module existed: `{ slots, hiddenSlots }`, nothing added.
 * - `?path=/x&scope=page`: the sections the page's own Document declares.
 *   Answered `{ scope: "page", slots, hiddenSlots }`.
 * - `?scope=layout&layout=default&path=/x`: the sections the shared layout
 *   Document declares (today the singleton `layout` template), as page `/x`
 *   renders them. Answered `{ scope: "layout", layout: "default", slots,
 *   hiddenSlots }`.
 *
 * Both scoped reads are per path, and both are cut from that path's merged
 * read (`storefrontScopedContent`): layout and page share one slot namespace,
 * so a section either Document hides is hidden in both scoped answers, as it
 * is in the merged one.
 *
 * The echoed `scope` is the version marker. An answerer from before scoped
 * reads ignores the parameter and answers the merged content without it, so
 * the SDK refuses that answer (`invalid_response`) rather than reading merged
 * content as page-only or layout content. Old SDK copies in existing builds
 * never send `scope` and keep the legacy answer byte for byte.
 *
 * Every function here is self-contained, using nothing outside itself (no
 * inner functions either), so the content servers that run outside Core (the
 * preview Worker and dev server, a build's prerender servers) embed it by
 * source (`toString`) and answer exactly as Core does.
 */

export type StorefrontContentScopedRead =
  | Readonly<{ scope: "page"; path: string }>
  | Readonly<{ scope: "layout"; layout: "default"; path: string }>;

/**
 * What a content read's query asks for: `null` for the legacy merged read
 * (no `scope` parameter; each endpoint keeps its own path handling for it),
 * a scoped read, or `"invalid"` for a scoped read that cannot be answered.
 *
 * The one path rule for every scoped reader: one `path`, starting with `/`,
 * at most 500 characters, whose percent escapes all decode; then one
 * canonical key: the URL pathname spelling (non-ASCII percent-encoded, as
 * `Astro.url.pathname`, a browser's `location.pathname` and the Astro route
 * registry spell it), with no query and no trailing `/`
 * (`normalizeRoutePath`). `/關於` and `/%E9%97%9C%E6%96%BC` are one key.
 */
export function storefrontContentScopedRead(
  params: URLSearchParams,
): StorefrontContentScopedRead | "invalid" | null {
  const scopes = params.getAll("scope");
  if (scopes.length === 0) return null;
  if (scopes.length !== 1) return "invalid";
  const scope = scopes[0];
  if (scope !== "page" && scope !== "layout") return "invalid";
  const paths = params.getAll("path");
  const raw = paths.length === 1 ? paths[0] : null;
  if (typeof raw !== "string" || raw.length > 500 || !raw.startsWith("/")) {
    return "invalid";
  }
  try {
    decodeURIComponent(raw);
  } catch {
    return "invalid";
  }
  let canonical: string;
  try {
    // Prefixed, never resolved against a base: `//x` stays a path.
    canonical = new URL("http://morph.invalid" + raw.split("?")[0]).pathname;
  } catch {
    return "invalid";
  }
  const path = canonical.replace(/\/+$/, "") || "/";
  if (scope === "page") {
    if (params.has("layout")) return "invalid";
    return { scope: "page", path };
  }
  const layouts = params.getAll("layout");
  // One shared layout exists today: the singleton layout Document.
  if (layouts.length !== 1 || layouts[0] !== "default") return "invalid";
  return { scope: "layout", layout: "default", path };
}

/**
 * A scoped read's content: the merged content of the same path, restricted.
 *
 * - `slots`: the merged values of the ids the scope's Document declares
 *   (`pageIds` for the page, `layoutIds` for the layout), in that order.
 *   Where both Documents declare an id, both reads carry the merged value,
 *   the one this page renders.
 * - `hiddenSlots`: every id the merged read hides on this path, whichever
 *   Document hid it or declares it. A layout component that renders an id
 *   its Document never declared (its defaults) is still hidden where the
 *   page hides that id, exactly as under the merged read.
 *
 * A pure restriction of the merged read, so it can never disagree with it,
 * carry a value it does not, or keep a value an edit to it replaced.
 */
export function storefrontScopedContent(
  scope: "page" | "layout",
  merged: Readonly<{
    slots: Readonly<Record<string, unknown>>;
    hiddenSlots: readonly string[];
  }>,
  pageIds: readonly string[],
  layoutIds: readonly string[],
): { slots: Record<string, unknown>; hiddenSlots: string[] } {
  const slots: Record<string, unknown> = {};
  const ids = scope === "page" ? pageIds : layoutIds;
  for (const id of ids) {
    if (typeof id !== "string" || id === "__proto__") continue;
    if (Object.prototype.hasOwnProperty.call(slots, id)) continue;
    if (merged.hiddenSlots.includes(id)) continue;
    if (Object.prototype.hasOwnProperty.call(merged.slots, id)) {
      slots[id] = merged.slots[id];
    }
  }
  return { slots, hiddenSlots: [...merged.hiddenSlots] };
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
