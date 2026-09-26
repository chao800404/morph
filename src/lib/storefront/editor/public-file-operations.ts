import {
  checkThemePublicPath,
  describeThemePublicProblem,
  THEME_PUBLIC_DIRECTORY,
  THEME_PUBLIC_LIMITS,
} from "@/lib/storefront/theme-public-files";

/**
 * What Code mode's Explorer and the Assets page both do to `public/` files,
 * decided without either of them: whether a write may be sent, what batch a
 * move or copy is, and where a typed destination points.
 *
 * Every answer here is only an earlier one. The server checks the path, the
 * format, the quota and each file's version itself.
 */

/** Why a new or replacing write should not be sent, or null to send it. */
export function checkPublicFileWrite(input: {
  path: string;
  size: number;
  /** Whether the write replaces the file at `path`. */
  replacing: boolean;
  /** Every path the workspace holds, source and binary. */
  existingPaths: ReadonlySet<string>;
}): string | null {
  const check = checkThemePublicPath(input.path);
  if (!check.ok) {
    return `${input.path}: ${describeThemePublicProblem(check.reason)}`;
  }
  if (input.size > THEME_PUBLIC_LIMITS.maxFileBytes) {
    return `${input.path}: ${describeThemePublicProblem("file-too-large")}`;
  }
  if (!input.replacing && input.existingPaths.has(input.path)) {
    return `${input.path} already exists. Replace it from its menu instead.`;
  }
  return null;
}

export type BinaryFileRef = Readonly<{ id: string; version: number }>;

export type BinaryMoveBatch = Readonly<{
  binaryCopies: Array<{
    from: string;
    to: string;
    expectedFileId: string;
    expectedVersion: number;
  }>;
  deletions: Array<{
    path: string;
    expectedFileId: string;
    expectedVersion: number;
  }>;
}>;

/**
 * The batch that moves binary files, or copies them when `keepSources`: a
 * copy of each at its new path, named by the source's id and version, and
 * for a move the source in the same batch's deletions.
 */
export function planBinaryMoveBatch(input: {
  moves: ReadonlyArray<{ from: string; to: string }>;
  binaryByPath: ReadonlyMap<string, BinaryFileRef>;
  keepSources: boolean;
}):
  | Readonly<{ ok: true; batch: BinaryMoveBatch }>
  | Readonly<{ ok: false; reason: string }> {
  const binaryCopies: BinaryMoveBatch["binaryCopies"] = [];
  const deletions: BinaryMoveBatch["deletions"] = [];
  for (const move of input.moves) {
    const source = input.binaryByPath.get(move.from);
    if (!source) {
      return {
        ok: false,
        reason: `${move.from} is no longer in the workspace.`,
      };
    }
    if (!move.to.startsWith(THEME_PUBLIC_DIRECTORY)) {
      return {
        ok: false,
        reason: `${move.from} can only move within public/.`,
      };
    }
    binaryCopies.push({
      from: move.from,
      to: move.to,
      expectedFileId: source.id,
      expectedVersion: source.version,
    });
    if (!input.keepSources) {
      deletions.push({
        path: move.from,
        expectedFileId: source.id,
        expectedVersion: source.version,
      });
    }
  }
  if (binaryCopies.length === 0)
    return { ok: false, reason: "Nothing to move." };
  return { ok: true, batch: { binaryCopies, deletions } };
}

/**
 * The path an author means by a destination typed relative to `public/`:
 * `banners/hero.png`, `/banners/hero.png` or `public/banners/hero.png`.
 */
export function publicFileDestination(
  typed: string,
):
  | Readonly<{ ok: true; path: string }>
  | Readonly<{ ok: false; reason: string }> {
  const trimmed = typed.trim().replace(/^\/+/, "");
  const path = trimmed.startsWith(THEME_PUBLIC_DIRECTORY)
    ? trimmed
    : `${THEME_PUBLIC_DIRECTORY}${trimmed}`;
  if (path === THEME_PUBLIC_DIRECTORY || path.endsWith("/")) {
    return { ok: false, reason: "Name the file, not only a folder." };
  }
  const check = checkThemePublicPath(path);
  if (!check.ok) {
    return { ok: false, reason: describeThemePublicProblem(check.reason) };
  }
  return { ok: true, path };
}

/**
 * Where a library asset copied into `folder` would land, as a path an author
 * can accept or change: the asset's name as a URL-safe file name with the
 * extension of the stored file, made unique among `existingPaths`.
 */
export function suggestPublicAssetPath(input: {
  folder: string;
  asset: Readonly<{ name: string; url: string }>;
  existingPaths: ReadonlySet<string>;
}): string {
  const extension = /\.([a-z0-9]+)$/i.exec(input.asset.url)?.[1]?.toLowerCase();
  const stem =
    input.asset.name
      .replace(/\.[a-z0-9]+$/i, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "asset";
  const folder = input.folder.replace(/\/+$/, "");
  const at = (suffix: string) =>
    `${folder}/${stem}${suffix}${extension ? `.${extension}` : ""}`;
  let path = at("");
  for (let n = 2; input.existingPaths.has(path); n += 1) path = at(`-${n}`);
  return path;
}
