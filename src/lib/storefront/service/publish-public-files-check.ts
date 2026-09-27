import type { StorefrontThemeRevisionDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { calculateThemeSourceSha256 } from "@/lib/storefront/storage/cloudflare-r2-theme-source-blob-store";
import { checkThemePublicBytes } from "@/lib/storefront/theme-public-bytes";
import {
  checkThemePublicPath,
  describeThemePublicProblem,
  isThemePublicPath,
  isThemePublicSvgPath,
  THEME_PUBLIC_LIMITS,
} from "@/lib/storefront/theme-public-files";

/**
 * The `public/` files of the revision a publish is about to activate, checked
 * against the contract as it stands now.
 *
 * Checked on the frozen revision — the one `publishTemplate` has resolved and
 * bound to a succeeded build — never the workspace, so what is judged is what
 * goes live. Both are immutable: the revision's entries do not change, and a
 * blob is addressed by its own digest, which is verified here. So the verdict
 * cannot be overtaken between this check and the activation that follows it.
 *
 * Why again, when every write already checked: the rules move. An SVG stored
 * under one version of `validateSvg` may be refused by the next, and a
 * revision may be published long after it was taken — including the active
 * release's own, which a content-only publish reuses. The build judged the
 * same revision's paths against its routes; this repeats the per-file part,
 * and reads the bytes of the files whose safety is in their content (SVG).
 * Raster and font bytes are not re-read: their signature was checked when
 * they were written and nothing about them is judged by rules that change.
 */

export type PublishPublicFilesDeps = Readonly<{
  getRevision(revisionId: string): Promise<StorefrontThemeRevisionDTO | null>;
  /** The blob's bytes; throws when the store has none. */
  readBlob(digest: string): Promise<Uint8Array>;
}>;

type RevisionPublicEntry = Readonly<{
  path: string;
  encoding: "binary" | "text";
  digest: string;
  sizeBytes: number;
}>;

function publicEntriesOf(
  revision: StorefrontThemeRevisionDTO,
): RevisionPublicEntry[] {
  const fromManifest = revision.sourceManifest?.files.map((file) => ({
    path: file.path,
    encoding:
      file.encoding === "binary" ? ("binary" as const) : ("text" as const),
    digest: file.digest,
    sizeBytes: file.sizeBytes,
  }));
  const entries =
    fromManifest ??
    revision.snapshot.map((file) =>
      file.encoding === "binary"
        ? {
            path: file.path,
            encoding: "binary" as const,
            digest: file.blobDigest,
            sizeBytes: file.sizeBytes,
          }
        : {
            path: file.path,
            encoding: "text" as const,
            digest: "",
            sizeBytes: file.content.length,
          },
    );
  return entries.filter((entry) => isThemePublicPath(entry.path));
}

/** Every problem with the revision's public/ files, one line each. */
export async function findPublishPublicFileProblems(
  deps: PublishPublicFilesDeps,
  revisionId: string,
): Promise<string[]> {
  const revision = await deps.getRevision(revisionId);
  if (!revision) {
    return [`Source revision ${revisionId} was not found.`];
  }
  const problems: string[] = [];
  for (const entry of publicEntriesOf(revision)) {
    if (entry.encoding === "text") {
      problems.push(
        `${entry.path}: Files in public/ are uploaded, not written as text.`,
      );
      continue;
    }
    const pathCheck = checkThemePublicPath(entry.path);
    if (!pathCheck.ok) {
      problems.push(
        `${entry.path}: ${describeThemePublicProblem(pathCheck.reason)}`,
      );
      continue;
    }
    if (!isThemePublicSvgPath(entry.path)) continue;
    // Size first, from the revision: an oversized file is refused unread.
    if (entry.sizeBytes > THEME_PUBLIC_LIMITS.maxSvgBytes) {
      problems.push(
        `${entry.path}: ${describeThemePublicProblem("svg-too-large")}`,
      );
      continue;
    }
    // A blob the store cannot produce, or refuses as corrupt, refuses the
    // publish by name rather than failing it with the store's error.
    let bytes: Uint8Array;
    try {
      bytes = await deps.readBlob(entry.digest);
    } catch (error) {
      problems.push(
        `${entry.path}: The stored bytes could not be read (${error instanceof Error ? error.message : String(error)}).`,
      );
      continue;
    }
    // Checked here too: not every store verifies what it returns.
    if (calculateThemeSourceSha256(bytes) !== entry.digest) {
      problems.push(
        `${entry.path}: The stored bytes do not match the revision's digest.`,
      );
      continue;
    }
    const bytesCheck = checkThemePublicBytes(entry.path, bytes);
    if (!bytesCheck.ok) problems.push(`${entry.path}: ${bytesCheck.message}`);
  }
  return problems;
}

/**
 * `findPublishPublicFileProblems`, as the refusal `publishTemplate` raises
 * before it activates anything.
 */
export async function assertPublishPublicFiles(
  deps: PublishPublicFilesDeps,
  revisionId: string,
): Promise<void> {
  const problems = await findPublishPublicFileProblems(deps, revisionId);
  if (problems.length > 0) {
    throw new Error(`PUBLISH_PUBLIC_FILE_REFUSED: ${problems.join(" ")}`);
  }
}
