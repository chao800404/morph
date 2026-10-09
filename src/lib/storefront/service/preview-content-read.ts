/**
 * Reads what a preview content snapshot is built from as one consistent
 * state (docs/astro-theme-plan.md 6.6).
 *
 * The snapshot takes more than one read — templates, pages — and a draft
 * write can land between them. So the drafts' versions are read before and
 * after; the content is used only when the two agree, which means no write
 * landed in between, and it is read again otherwise. A state that keeps
 * moving is refused rather than snapshotted half-old, half-new.
 */
export const PREVIEW_CONTENT_READ_ATTEMPTS = 3;

export type PreviewContentRead<T> =
  | Readonly<{ ok: true; content: T; versions: string }>
  | Readonly<{ ok: false; error: "PREVIEW_CONTENT_UNSTABLE" }>;

export async function readConsistentPreviewContent<T>(args: {
  readVersions: () => Promise<string>;
  readContent: () => Promise<T>;
  attempts?: number;
}): Promise<PreviewContentRead<T>> {
  const attempts = args.attempts ?? PREVIEW_CONTENT_READ_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const before = await args.readVersions();
    const content = await args.readContent();
    const after = await args.readVersions();
    if (before === after) return { ok: true, content, versions: after };
  }
  return { ok: false, error: "PREVIEW_CONTENT_UNSTABLE" };
}
