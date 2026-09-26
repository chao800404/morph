import { isBinaryThemeFile } from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  confirmPublicUrlRewrites,
  type PublicUrlBatchFile,
  type PublicUrlRewriteRequest,
} from "@/lib/storefront/editor/public-url-move-batch";
import type { ThemeSourceStore } from "@/lib/storefront/storage/theme-storage.types";

export type ConfirmedPublicUrlRewriteBatch =
  | Readonly<{
      ok: true;
      files: Array<PublicUrlBatchFile & { expectMissing: boolean }>;
    }>
  | Readonly<{
      ok: false;
      error:
        | "SOURCE_GENERATION_CONFLICT"
        | "PUBLIC_URL_REWRITE_INVALID"
        | "PUBLIC_URL_REWRITE_STALE"
        | "PUBLIC_URL_REWRITE_UNACKNOWLEDGED";
      reason: string;
    }>;

/**
 * The batch's text writes with the URL references its copies carry
 * rewritten, planned from the source as saved rather than taken from the
 * editor.
 *
 * The batch that follows commits only at `expectedSourceGeneration`, and
 * every write advances it, so a batch that lands is one whose source is
 * exactly what this read — however the read and a concurrent save
 * interleaved, a save in between fails the batch. The generation is checked
 * here too only to say so plainly, before planning against a moved Theme.
 */
export async function planConfirmedPublicUrlRewrite(
  store: Pick<ThemeSourceStore, "getSourceGeneration" | "getWorkspaceSnapshot">,
  input: {
    storefrontId: string;
    themeId: string;
    expectedSourceGeneration: number;
    files: readonly PublicUrlBatchFile[];
    deletions: ReadonlyArray<{ path: string }>;
    binaryCopies: ReadonlyArray<{ from: string; to: string }>;
    publicUrlRewrite: PublicUrlRewriteRequest;
  },
): Promise<ConfirmedPublicUrlRewriteBatch> {
  const [generation, entries] = await Promise.all([
    store.getSourceGeneration(input.storefrontId, input.themeId),
    store.getWorkspaceSnapshot(input.storefrontId, input.themeId),
  ]);
  if (generation !== input.expectedSourceGeneration) {
    return {
      ok: false,
      error: "SOURCE_GENERATION_CONFLICT",
      reason: `Remote source changes detected in batch (current generation: ${generation ?? "unknown"}): the theme working source was updated by another operation.`,
    };
  }
  const confirmed = confirmPublicUrlRewrites({
    saved: entries
      .filter((entry) => !isBinaryThemeFile(entry))
      .map((entry) => ({
        id: entry.id,
        path: entry.path,
        content: entry.content,
        version: entry.version,
        mimeType: entry.mimeType,
      })),
    files: input.files,
    deletions: input.deletions,
    binaryCopies: input.binaryCopies,
    rewrites: input.publicUrlRewrite.moves,
    expected: input.publicUrlRewrite.expected,
    acknowledgeUnresolved: input.publicUrlRewrite.acknowledgeUnresolved,
  });
  if (!confirmed.ok) return confirmed;
  return {
    ok: true,
    files: confirmed.files.map((file) => ({
      ...file,
      expectMissing: file.expectMissing ?? false,
    })),
  };
}
