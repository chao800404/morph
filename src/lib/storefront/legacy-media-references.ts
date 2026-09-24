import { assetIdFromDeliveryUrl } from "@/lib/asset/media-asset-identity";

/**
 * Library images stored as a bare CMS URL rather than as an asset reference.
 *
 * A field whose value is `/assets/<id>.<ext>` renders for its author, whose
 * session can read that route, and for nobody else: a published storefront
 * serves only the assets its publication references, and a bare URL names no
 * asset as far as publishing can tell. So such a value is broken for every
 * visitor, and nothing said so.
 *
 * Found rather than rewritten: a field typed as a string cannot hold an asset
 * reference, so the publish confirmation lists where each one is and the
 * author decides.
 */

export type LegacyMediaReference = Readonly<{
  sectionId: string;
  sectionType: string;
  /** Dotted path within the section's props, e.g. `items.2.imageSrc`. */
  fieldPath: string;
}>;

export type LegacyMediaFinding = Readonly<{
  /** Which page or template the document is, as an author would name it. */
  label: string;
  references: readonly LegacyMediaReference[];
}>;

function visit(
  value: unknown,
  path: string,
  depth: number,
  found: string[],
): void {
  if (depth > 20) return;
  if (typeof value === "string") {
    if (assetIdFromDeliveryUrl(value)) found.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visit(item, path ? `${path}.${index}` : String(index), depth + 1, found),
    );
    return;
  }
  if (value && typeof value === "object") {
    // An asset reference carries its delivery URL too, but the reference is
    // what publishing reads; only a URL standing on its own is the problem.
    if ((value as { source?: unknown }).source === "asset") return;
    // Once an image is grouped, `imageSrc`/`imageAlt` beside it are kept only
    // for documents written before; a component reads `image` first, as the
    // Inspector does. A stale URL left there is not what visitors see.
    const shadowed = (value as { image?: unknown }).image !== undefined;
    for (const [key, item] of Object.entries(value)) {
      if (shadowed && (key === "imageSrc" || key === "imageAlt")) continue;
      visit(item, path ? `${path}.${key}` : key, depth + 1, found);
    }
  }
}

/** Every bare library URL in a document's section content. */
export function findLegacyMediaReferences(
  document: unknown,
): LegacyMediaReference[] {
  const sections =
    document && typeof document === "object"
      ? (document as { sections?: unknown }).sections
      : null;
  if (!Array.isArray(sections)) return [];
  const references: LegacyMediaReference[] = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const { id, type, props } = section as {
      id?: unknown;
      type?: unknown;
      props?: unknown;
    };
    const paths: string[] = [];
    visit(props, "", 0, paths);
    for (const fieldPath of paths) {
      references.push({
        sectionId: typeof id === "string" ? id : "",
        sectionType: typeof type === "string" ? type : "",
        fieldPath,
      });
    }
  }
  return references;
}

/** Each place an author has to fix, as `page › section › field`. */
export function legacyMediaPlaces(
  findings: readonly LegacyMediaFinding[],
): string[] {
  return findings.flatMap((finding) =>
    finding.references.map(
      (reference) =>
        `${finding.label} › ${reference.sectionType || reference.sectionId} › ${reference.fieldPath}`,
    ),
  );
}
