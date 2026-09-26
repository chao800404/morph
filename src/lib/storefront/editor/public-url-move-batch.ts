import { themePublicUrlPath } from "@/lib/storefront/theme-public-files";
import {
  planPublicUrlRewrites,
  type PublicUrlMove,
  type PublicUrlRewritePlan,
} from "./public-url-rewrite";

/**
 * A batch that moves or copies `public/` files, with the Theme source that
 * names their URLs rewritten in the same write.
 *
 * The editor calls this to show the author what a move will change; the
 * server calls it again on the files as saved when the author confirms, and
 * writes what it finds itself rather than any content the editor planned.
 * Both read the same input — the saved source, with the batch's own writes
 * laid over it — so an unchanged Theme gives the same answer twice, and a
 * Theme that changed in between gives a different one, which is refused.
 */

export type PublicUrlBatchFile = {
  path: string;
  content: string;
  mimeType?: string;
  expectedFileId?: string;
  expectedVersion?: number;
  expectMissing?: boolean;
};

export type PublicUrlSavedFile = Readonly<{
  id: string;
  path: string;
  content: string;
  version: number;
  mimeType?: string;
}>;

export type PublicUrlBatchInput = Readonly<{
  /** Theme source as saved, text files only. */
  saved: readonly PublicUrlSavedFile[];
  files: readonly PublicUrlBatchFile[];
  deletions: ReadonlyArray<{ path: string }>;
  binaryCopies: ReadonlyArray<{ from: string; to: string }>;
  /** The copies, by file path, whose URL references are to follow them. */
  rewrites: ReadonlyArray<{ from: string; to: string }>;
}>;

/** What the author confirmed, for the server to hold its own plan to. */
export type PublicUrlRewriteSummary = Readonly<{
  paths: string[];
  rewriteCount: number;
  unresolvedCount: number;
}>;

export type PublicUrlBatchResult =
  | Readonly<{
      ok: true;
      /** The batch's writes, with the rewritten files added or updated. */
      files: PublicUrlBatchFile[];
      plan: PublicUrlRewritePlan;
      urlMoves: PublicUrlMove[];
      /** Whether the batch removes a file whose old URL may still be in use. */
      removesOldUrls: boolean;
    }>
  | Readonly<{ ok: false; reason: string }>;

export function withPublicUrlRewrites(
  input: PublicUrlBatchInput,
): PublicUrlBatchResult {
  const copies = new Set(
    input.binaryCopies.map((copy) => `${copy.from}\u0000${copy.to}`),
  );
  const deleted = new Set(input.deletions.map((deletion) => deletion.path));
  const urlMoves: PublicUrlMove[] = [];
  for (const rewrite of input.rewrites) {
    // Only a copy in this very batch may be followed: the new URL then
    // names a file that exists once the batch lands, and nothing else.
    if (!copies.has(`${rewrite.from}\u0000${rewrite.to}`)) {
      return {
        ok: false,
        reason: `${rewrite.from} → ${rewrite.to} is not a copy in this batch.`,
      };
    }
    const from = themePublicUrlPath(rewrite.from);
    const to = themePublicUrlPath(rewrite.to);
    if (!from || !to) {
      return {
        ok: false,
        reason: `${rewrite.from} → ${rewrite.to} is not within public/.`,
      };
    }
    urlMoves.push({ from, to });
  }
  if (urlMoves.length === 0) {
    return { ok: false, reason: "No URL to rewrite." };
  }

  const texts = new Map(input.saved.map((file) => [file.path, file.content]));
  for (const file of input.files) texts.set(file.path, file.content);
  for (const path of deleted) texts.delete(path);

  const planned = planPublicUrlRewrites(
    [...texts].map(([path, content]) => ({ path, content })),
    urlMoves,
  );
  if (!planned.ok) return planned;

  const savedByPath = new Map(input.saved.map((file) => [file.path, file]));
  const files = input.files.map((file) => ({ ...file }));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const write of planned.plan.writes) {
    const inBatch = filesByPath.get(write.path);
    if (inBatch) {
      inBatch.content = write.content;
      continue;
    }
    const saved = savedByPath.get(write.path);
    if (!saved) {
      return { ok: false, reason: `${write.path} is not in the workspace.` };
    }
    files.push({
      path: saved.path,
      content: write.content,
      ...(saved.mimeType ? { mimeType: saved.mimeType } : {}),
      expectedFileId: saved.id,
      expectedVersion: saved.version,
    });
  }

  return {
    ok: true,
    files,
    plan: planned.plan,
    urlMoves,
    removesOldUrls: input.rewrites.some((rewrite) => deleted.has(rewrite.from)),
  };
}

export function summarizePublicUrlRewrite(
  plan: PublicUrlRewritePlan,
): PublicUrlRewriteSummary {
  return {
    paths: plan.writes.map((write) => write.path).sort(),
    rewriteCount: plan.rewrites.length,
    unresolvedCount: plan.unresolved.length,
  };
}

/** What a batch request carries to have URL references follow its copies. */
export type PublicUrlRewriteRequest = {
  moves: Array<{ from: string; to: string }>;
  expected: PublicUrlRewriteSummary;
  acknowledgeUnresolved: boolean;
};

export type PublicUrlRewriteConfirmation = Readonly<{
  expected: PublicUrlRewriteSummary;
  /** The author saw references that stay unresolved and moved anyway. */
  acknowledgeUnresolved: boolean;
}>;

export type ConfirmedPublicUrlBatch =
  | Readonly<{ ok: true; files: PublicUrlBatchFile[] }>
  | Readonly<{
      ok: false;
      error:
        | "PUBLIC_URL_REWRITE_INVALID"
        | "PUBLIC_URL_REWRITE_STALE"
        | "PUBLIC_URL_REWRITE_UNACKNOWLEDGED";
      reason: string;
    }>;

/**
 * The server's side: plans again from the saved files and writes that plan
 * only if it is the one the author confirmed.
 */
export function confirmPublicUrlRewrites(
  input: PublicUrlBatchInput & PublicUrlRewriteConfirmation,
): ConfirmedPublicUrlBatch {
  const result = withPublicUrlRewrites(input);
  if (!result.ok) {
    return {
      ok: false,
      error: "PUBLIC_URL_REWRITE_INVALID",
      reason: result.reason,
    };
  }
  const found = summarizePublicUrlRewrite(result.plan);
  const same =
    found.rewriteCount === input.expected.rewriteCount &&
    found.unresolvedCount === input.expected.unresolvedCount &&
    found.paths.length === input.expected.paths.length &&
    [...input.expected.paths]
      .sort()
      .every((path, index) => path === found.paths[index]);
  if (!same) {
    return {
      ok: false,
      error: "PUBLIC_URL_REWRITE_STALE",
      reason:
        "The references to these files changed since they were reviewed. Review the move again.",
    };
  }
  if (
    result.removesOldUrls &&
    found.unresolvedCount > 0 &&
    !input.acknowledgeUnresolved
  ) {
    return {
      ok: false,
      error: "PUBLIC_URL_REWRITE_UNACKNOWLEDGED",
      reason:
        "Some references could not be updated. Confirm that the old URLs may stop working, or keep the old files.",
    };
  }
  return { ok: true, files: result.files };
}
