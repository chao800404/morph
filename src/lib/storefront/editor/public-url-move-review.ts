import { themePublicUrlPath } from "@/lib/storefront/theme-public-files";
import {
  summarizePublicUrlRewrite,
  withPublicUrlRewrites,
  type PublicUrlBatchFile,
  type PublicUrlRewriteSummary,
  type PublicUrlSavedFile,
} from "./public-url-move-batch";
import {
  planPublicUrlRewrites,
  type PublicUrlRewritePlan,
} from "./public-url-rewrite";

/**
 * What the editor shows before a move changes `public/` URLs: each URL that
 * changes, the references it would update and the ones it cannot.
 *
 * The plan is made from the source as saved, because that is what the server
 * plans from again when the author confirms. An unsaved draft is therefore
 * not seen by it — so a draft that names one of the URLs, in a file the move
 * does not already write, stops the rewrite: updating the saved file would
 * leave the draft one save away from putting the old URL back.
 */

export type PublicUrlMoveReview = Readonly<{
  changes: ReadonlyArray<{ from: string; to: string }>;
  rewrite:
    | Readonly<{
        kind: "ready";
        plan: PublicUrlRewritePlan;
        summary: PublicUrlRewriteSummary;
      }>
    | Readonly<{ kind: "blocked"; unsavedPaths: string[] }>
    | Readonly<{ kind: "unavailable"; reason: string }>;
}>;

export function reviewPublicUrlMove(input: {
  saved: readonly PublicUrlSavedFile[];
  /** Unsaved editor content, by path, for files that differ from saved. */
  drafts: ReadonlyMap<string, string>;
  /** The move's batch, binary sources in `deletions`. */
  files: readonly PublicUrlBatchFile[];
  deletions: ReadonlyArray<{ path: string }>;
  binaryMoves: ReadonlyArray<{ from: string; to: string }>;
}): PublicUrlMoveReview {
  const changes = input.binaryMoves.map((move) => ({
    from: themePublicUrlPath(move.from) ?? move.from,
    to: themePublicUrlPath(move.to) ?? move.to,
  }));

  const written = new Set(input.files.map((file) => file.path));
  const savedByPath = new Map(input.saved.map((file) => [file.path, file]));
  const namesAUrl = (path: string, content: string) => {
    const result = planPublicUrlRewrites([{ path, content }], changes);
    return (
      result.ok &&
      (result.plan.rewrites.length > 0 || result.plan.unresolved.length > 0)
    );
  };
  const unsavedPaths = [...input.drafts]
    .filter(
      ([path, draft]) =>
        !written.has(path) &&
        (namesAUrl(path, draft) ||
          namesAUrl(path, savedByPath.get(path)?.content ?? "")),
    )
    .map(([path]) => path)
    .sort();
  if (unsavedPaths.length > 0) {
    return { changes, rewrite: { kind: "blocked", unsavedPaths } };
  }

  const result = withPublicUrlRewrites({
    saved: input.saved,
    files: input.files,
    deletions: input.deletions,
    binaryCopies: input.binaryMoves,
    rewrites: input.binaryMoves,
  });
  if (!result.ok) {
    return { changes, rewrite: { kind: "unavailable", reason: result.reason } };
  }
  return {
    changes,
    rewrite: {
      kind: "ready",
      plan: result.plan,
      summary: summarizePublicUrlRewrite(result.plan),
    },
  };
}
