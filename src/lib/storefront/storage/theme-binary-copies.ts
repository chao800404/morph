import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import {
  isBinaryThemeFile,
  type StorefrontThemeFileDTO,
  type StorefrontThemeWorkspaceEntryDTO,
} from "../dto/storefront-theme-file.dto";
import {
  checkThemePublicFiles,
  checkThemePublicPath,
  describeThemePublicProblem,
  isThemePublicPath,
} from "../theme-public-files";

/**
 * A binary file placed at a new path within a batch: what the client asks.
 *
 * It names the source by path, id and version and nothing else. The bytes
 * are already in the content-addressed store, shared across every Theme, so
 * a digest taken from a client would let it point at any stored file; the
 * digest, size and MIME type are read from the source row instead.
 */
export type ThemeBinaryCopyRequest = Readonly<{
  from: string;
  to: string;
  expectedFileId: string;
  expectedVersion: number;
}>;

/** A copy the server has checked, carrying what it read from the source. */
export type ResolvedThemeBinaryCopy = Readonly<{
  from: string;
  to: string;
  sourceFileId: string;
  sourceVersion: number;
  blobDigest: string;
  sizeBytes: number;
  mimeType: string;
}>;

/**
 * Checks every copy in a batch against the workspace and against each other,
 * and the `public/` set the whole batch leaves behind.
 *
 * A move is a copy plus the source's deletion in the same batch, so this is
 * also what judges moves. Destinations must be new: not an existing file —
 * not even one this batch deletes, so a swap or a chain is refused rather
 * than ordered — not a source write in the same batch, not another copy's
 * destination or source. Errors about the source being stale carry the
 * `CONFLICT_VERSION_MISMATCH` prefix the batch already reports as a conflict;
 * the rest are `THEME_PUBLIC_FILE_REFUSED`.
 */
export function planThemeBinaryCopies(args: {
  entries: readonly StorefrontThemeWorkspaceEntryDTO[];
  copies: readonly ThemeBinaryCopyRequest[];
  writes: readonly { path: string; content: string }[];
  deletions: readonly { path: string }[];
}):
  | { ok: true; copies: ResolvedThemeBinaryCopy[] }
  | { ok: false; message: string } {
  const byPath = new Map(args.entries.map((entry) => [entry.path, entry]));
  const deleted = new Set(args.deletions.map((deletion) => deletion.path));
  const written = new Set(args.writes.map((write) => write.path));
  const sources = new Set(args.copies.map((copy) => copy.from));

  // The source files this batch leaves, whose routes a destination may not
  // take: the same judgement an upload and a build make.
  const nextSource = new Map<string, { path: string; content: string }>();
  for (const entry of args.entries) {
    if (!isBinaryThemeFile(entry) && !deleted.has(entry.path)) {
      nextSource.set(entry.path, entry as StorefrontThemeFileDTO);
    }
  }
  for (const write of args.writes) nextSource.set(write.path, write);
  const routePaths = buildThemeRouteRegistry([
    ...nextSource.values(),
  ]).routes.map((route) => route.path);

  const destinations = new Set<string>();
  const resolved: ResolvedThemeBinaryCopy[] = [];
  for (const copy of args.copies) {
    const source = byPath.get(copy.from);
    if (
      !source ||
      !isBinaryThemeFile(source) ||
      source.id !== copy.expectedFileId ||
      source.version !== copy.expectedVersion
    ) {
      return {
        ok: false,
        message: `CONFLICT_VERSION_MISMATCH: "${copy.from}" is not the binary file this change was planned from.`,
      };
    }
    if (
      byPath.has(copy.to) ||
      written.has(copy.to) ||
      sources.has(copy.to) ||
      destinations.has(copy.to)
    ) {
      return {
        ok: false,
        message: `THEME_PUBLIC_FILE_REFUSED: ${copy.to}: That path is already taken.`,
      };
    }
    destinations.add(copy.to);

    const check = checkThemePublicPath(copy.to, routePaths);
    if (!check.ok) {
      return {
        ok: false,
        message: `THEME_PUBLIC_FILE_REFUSED: ${copy.to}: ${describeThemePublicProblem(check.reason)}`,
      };
    }
    // The bytes do not change, so neither may the format the name declares:
    // hero.png renamed hero.jpg would be served as a JPEG it is not.
    if (check.mimeType !== source.mimeType) {
      return {
        ok: false,
        message: `THEME_PUBLIC_FILE_REFUSED: ${copy.to}: The new name is a different format from "${copy.from}"; keep its extension.`,
      };
    }
    resolved.push({
      from: copy.from,
      to: copy.to,
      sourceFileId: source.id,
      sourceVersion: source.version,
      blobDigest: source.blobDigest,
      sizeBytes: source.sizeBytes,
      mimeType: source.mimeType,
    });
  }

  // The set the batch leaves: counts, total size and case collisions hold
  // for it, so a copy that keeps its source counts twice.
  const nextPublic = [
    ...args.entries
      .filter(
        (entry) =>
          isBinaryThemeFile(entry) &&
          isThemePublicPath(entry.path) &&
          !deleted.has(entry.path),
      )
      .map((entry) => ({
        path: entry.path,
        size: isBinaryThemeFile(entry) ? entry.sizeBytes : 0,
      })),
    ...resolved.map((copy) => ({ path: copy.to, size: copy.sizeBytes })),
  ];
  const setCheck = checkThemePublicFiles(nextPublic, routePaths);
  if (!setCheck.ok) {
    return {
      ok: false,
      message: `THEME_PUBLIC_FILE_REFUSED: ${setCheck.problems
        .map(
          (problem) =>
            `${problem.path}: ${describeThemePublicProblem(problem.reason)}`,
        )
        .join(" ")}`,
    };
  }
  return { ok: true, copies: resolved };
}
