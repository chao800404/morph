/**
 * Shared model for author-editable links (the Inspector's "Action Button").
 *
 * A link can point inside the store or at another site, and can open in the
 * same tab or a new one. Both the Document renderer and the Theme sources go
 * through here so a link behaves the same in the preview and on the built site.
 */

export type ThemeLinkTarget = "_self" | "_blank";

export const THEME_LINK_TARGETS: readonly ThemeLinkTarget[] = [
  "_self",
  "_blank",
];

export function isThemeLinkTarget(value: unknown): value is ThemeLinkTarget {
  return value === "_self" || value === "_blank";
}

export function normalizeThemeLinkTarget(value: unknown): ThemeLinkTarget {
  return isThemeLinkTarget(value) ? value : "_self";
}

/**
 * True when the href leaves the storefront.
 *
 * Protocol-relative (`//host`) counts: it resolves to another origin even
 * though it has no scheme. `mailto:` and `tel:` also hand off to another app,
 * so they are treated as external for `rel` purposes.
 */
export function isExternalThemeLink(href: string | null | undefined): boolean {
  if (!href) return false;
  const value = href.trim();
  if (value.startsWith("//")) return true;
  return /^(?:https?|mailto|tel):/i.test(value);
}

/**
 * Strips hrefs that would execute script instead of navigating.
 *
 * Control characters are removed before the scheme test so `java\tscript:` is
 * not able to slip past it. The original value is returned when it is safe, so
 * legitimate whitespace inside a path is preserved.
 */
export function sanitizeThemeLinkHref(
  href: string | null | undefined,
): string | undefined {
  if (typeof href !== "string") return undefined;
  const compact = href.trim().replace(/[\u0000-\u0020]+/g, "");
  if (!compact) return undefined;
  // `data:text/html` is followed by `;base64,` or `,` rather than another
  // colon, so the scheme terminator has to be per-alternative.
  if (/^(?:javascript:|vbscript:|data:text\/html)/i.test(compact)) {
    return undefined;
  }
  return href;
}

/**
 * `rel` for a link, or undefined when none is needed.
 *
 * A `target="_blank"` link to another origin gives that page a handle back to
 * this one through `window.opener`, which it can use to redirect the store to
 * a spoofed page. `noopener` severs that handle and `noreferrer` withholds the
 * originating URL.
 */
export function themeLinkRel(
  href: string | null | undefined,
  target: ThemeLinkTarget,
): string | undefined {
  if (target !== "_blank") return undefined;
  return isExternalThemeLink(href) ? "noopener noreferrer" : "noopener";
}

/** The `target`/`rel` pair to spread onto an anchor. */
export function themeLinkAnchorProps(
  href: string | null | undefined,
  target: unknown,
): { target?: ThemeLinkTarget; rel?: string } {
  const normalized = normalizeThemeLinkTarget(target);
  if (normalized === "_self") return {};
  return { target: normalized, rel: themeLinkRel(href, normalized) };
}

/**
 * Stored value of a `type: "link"` content field.
 *
 * `rel` is not stored. It is derived at render from `target` and `nofollow`, so
 * an author cannot save a link that opens a new tab without the protection that
 * has to come with it.
 */
export type ThemeLinkValue = {
  href: string;
  target?: ThemeLinkTarget;
  /** Tells search engines not to pass ranking credit through this link. */
  nofollow?: boolean;
  /** Advisory text, surfaced by the browser as a tooltip. */
  title?: string;
  /** Accessible name, for when the link text alone does not identify it. */
  ariaLabel?: string;
  /** Saves the target instead of navigating to it. */
  download?: boolean;
};

/** Keys a stored link value may carry. */
export const THEME_LINK_VALUE_KEYS = [
  "href",
  "target",
  "nofollow",
  "title",
  "ariaLabel",
  "download",
] as const;

/**
 * A link with everything the component needs already worked out.
 *
 * `rel` is here and not in the stored value because it is not the author's to
 * get wrong: it follows from the target and the destination. Themes cannot
 * import Morph code, so a component that had to assemble `rel` itself would be
 * one forgotten expression away from shipping an unprotected new tab.
 */
export type ResolvedThemeLink = {
  href?: string;
  target?: ThemeLinkTarget;
  rel?: string;
  title?: string;
  ariaLabel?: string;
  download?: boolean;
};

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Reads a stored link value, tolerating the shapes it can arrive in.
 *
 * A bare string is read as the destination so the Inspector can open a value
 * left behind by a field that used to be a `url`, and writing it back stores
 * the object form. Note this is the editor's migration path only: slot values
 * carry no field types, so `resolveThemeLinksInSlotValues` recognises links by
 * shape and cannot promote a string without turning ordinary text into a link.
 */
export function normalizeThemeLinkValue(value: unknown): ThemeLinkValue {
  if (typeof value === "string") return { href: value, target: "_self" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { href: "", target: "_self" };
  }
  const source = value as Record<string, unknown>;
  return {
    href: readString(source, "href") ?? "",
    target: normalizeThemeLinkTarget(source.target),
    nofollow: source.nofollow === true,
    title: readString(source, "title"),
    ariaLabel: readString(source, "ariaLabel"),
    download: source.download === true,
  };
}

/**
 * Turns a stored link into the values a component renders.
 *
 * `download` is dropped for another origin: browsers ignore it cross-origin and
 * navigate instead, so honouring it here would report a behaviour the store
 * does not actually have.
 */
export function resolveThemeLink(value: unknown): ResolvedThemeLink {
  const link = normalizeThemeLinkValue(value);
  const href = sanitizeThemeLinkHref(link.href);
  const target = normalizeThemeLinkTarget(link.target);
  const external = isExternalThemeLink(href);
  const rel = [themeLinkRel(href, target), link.nofollow ? "nofollow" : ""]
    .filter(Boolean)
    .join(" ");
  return {
    href,
    target: target === "_blank" ? target : undefined,
    rel: rel || undefined,
    title: link.title,
    ariaLabel: link.ariaLabel,
    download: link.download && !external ? true : undefined,
  };
}

/** True for an object that is a stored link and nothing else. */
function isThemeLinkShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (typeof source.href !== "string") return false;
  return Object.keys(source).every((key) =>
    (THEME_LINK_VALUE_KEYS as readonly string[]).includes(key),
  );
}

/**
 * Replaces every stored link in one slot's values with its resolved form.
 *
 * Applied where content is handed to a Theme — the published content response
 * and the interpreted preview — so both surfaces give a component the same
 * link, `rel` included. Values that are not links are passed through
 * untouched.
 */
export function resolveThemeLinksInSlotValues(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (isThemeLinkShape(value)) {
      result[key] = resolveThemeLink(value);
      continue;
    }
    // A repeated row may hold a link of its own. Rows cannot contain rows, so
    // one level is the whole shape.
    if (Array.isArray(value)) {
      result[key] = value.map((row) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? resolveThemeLinksInSlotValues(row as Record<string, unknown>)
          : row,
      );
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * The attributes to put on an `<a>` for a link field.
 *
 * Returns `href: undefined` for a destination that would execute script, which
 * renders an inert anchor rather than a working exploit.
 */
export function themeLinkAttributes(value: unknown): {
  href?: string;
  target?: ThemeLinkTarget;
  rel?: string;
  title?: string;
  "aria-label"?: string;
} {
  const link = normalizeThemeLinkValue(value);
  const href = sanitizeThemeLinkHref(link.href);
  const target = normalizeThemeLinkTarget(link.target);
  const rel = [themeLinkRel(href, target), link.nofollow ? "nofollow" : ""]
    .filter(Boolean)
    .join(" ");
  return {
    href,
    target: target === "_blank" ? target : undefined,
    rel: rel || undefined,
    title: link.title,
    "aria-label": link.ariaLabel,
  };
}
