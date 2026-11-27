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
 * at most 500 characters, whose percent escapes all decode; then normalised
 * as Core keys routes (`normalizeRoutePath`: no query, no trailing `/`).
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
  const path = raw.split("?")[0]!.replace(/\/+$/, "") || "/";
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
 * A scoped read's content, cut from the merged content of the same path.
 *
 * - `merged`: that path's merged read; `shell`: the layout's content alone
 *   (the merged read of a path with no Document of its own).
 * - `pageIds`, `layoutIds`: the section ids each Document declares, in order.
 *
 * Page: each id the page declares, hidden if the merged read hides it, else
 * the merged values (the page's, which win in the merged read).
 *
 * Layout: each id the layout declares, hidden if the merged read hides it
 * (the layout or this page hid it); for an id the page also declares and
 * shows, the layout's own values (the merged read has the page's there);
 * otherwise the merged values, so a live edit of a layout section on this
 * page reads back here.
 *
 * Neither ever carries a value the merged read hides on that path, nor a
 * value outside what the merged read or the layout alone emits.
 */
export function storefrontScopedContent(
  scope: "page" | "layout",
  merged: Readonly<{
    slots: Readonly<Record<string, unknown>>;
    hiddenSlots: readonly string[];
  }>,
  shell: Readonly<{
    slots: Readonly<Record<string, unknown>>;
    hiddenSlots: readonly string[];
  }>,
  pageIds: readonly string[],
  layoutIds: readonly string[],
): { slots: Record<string, unknown>; hiddenSlots: string[] } {
  const slots: Record<string, unknown> = {};
  const hiddenSlots: string[] = [];
  const ids = scope === "page" ? pageIds : layoutIds;
  for (const id of ids) {
    if (typeof id !== "string" || id === "__proto__") continue;
    if (
      hiddenSlots.includes(id) ||
      Object.prototype.hasOwnProperty.call(slots, id)
    ) {
      continue;
    }
    if (merged.hiddenSlots.includes(id)) {
      hiddenSlots.push(id);
    } else if (scope === "layout" && pageIds.includes(id)) {
      if (shell.hiddenSlots.includes(id)) hiddenSlots.push(id);
      else if (Object.prototype.hasOwnProperty.call(shell.slots, id)) {
        slots[id] = shell.slots[id];
      }
    } else if (Object.prototype.hasOwnProperty.call(merged.slots, id)) {
      slots[id] = merged.slots[id];
    }
  }
  return { slots, hiddenSlots };
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
