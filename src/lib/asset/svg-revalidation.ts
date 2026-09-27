import { SVG_REVALIDATION_BATCH } from "@/lib/asset/svg-revalidation-batch";
import type { AssetDTO } from "@/lib/asset/dto/asset.dto";
import { assetStorageKey } from "@/lib/asset/storage-key";
import {
  SVG_VALIDATOR_METADATA_KEY,
  passedCurrentSvgRules,
} from "@/lib/asset/svg-delivery";
import {
  SVG_VALIDATOR_VERSION,
  validateSvg,
  type SvgRefusal,
} from "@/lib/security/svg-validation";

/**
 * Re-checks media-library SVGs recorded under older rules, so the ones that
 * pass the current rules may be shown inline again.
 *
 * Two steps, and only the second writes:
 * - `scanLibrarySvgs` reads each file and reports what the current rules say
 *   of it. It is a preview for an administrator, not permission to write.
 * - `restoreLibrarySvgs` does the whole check again for each file named: the
 *   asset still exists, its bytes as they are now, the current rules, and a
 *   write conditioned on the ETag the scan saw. It takes asset ids and ETags,
 *   never a list of what passed; a file changed since the scan, or refused
 *   now, is skipped and reported.
 *
 * A restored file keeps every header and every other metadata value it had;
 * only the validator version is set. A refused file is left as it is, served
 * as a download, for its author to fix. Nothing here runs when an image is
 * requested.
 *
 * R2's ETag is a hash of the bytes. So a file rewritten with the same bytes
 * keeps its ETag and is restored — its verdict cannot have changed — and a
 * change to its metadata alone, between this read and the write, is not seen
 * by the condition; the write keeps the metadata this read found. Nothing in
 * the library rewrites an object's metadata in place: uploads and edits
 * write new keys, and deletion moves the object away.
 */

/** The library's own size limit for an SVG. */
const MAX_SVG_BYTES = 2 * 1024 * 1024;

type StoredObject = {
  etag: string;
  size: number;
  httpMetadata?: Record<string, unknown>;
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type SvgRevalidationDeps = Readonly<{
  listSvgPage(afterId: string | null, limit: number): Promise<AssetDTO[]>;
  findAsset(id: string): Promise<AssetDTO | null>;
  getObject(key: string): Promise<StoredObject | null>;
  putObject(
    key: string,
    bytes: Uint8Array,
    options: {
      httpMetadata?: Record<string, unknown>;
      customMetadata: Record<string, string>;
      onlyIf: { etagMatches: string };
    },
  ): Promise<unknown | null>;
}>;

export type SvgScanEntry = Readonly<{
  assetId: string;
  name: string;
  /** The object's ETag when read, which a restore must still find. */
  etag: string | null;
  status: "passes" | "current" | "refused" | "missing";
  /** What was recorded before: a validator version, the legacy mark, or nothing. */
  recorded: string | null;
  reason?: SvgRefusal | "too-large";
  detail?: string;
  line?: number | null;
}>;

export type SvgScanPage = Readonly<{
  entries: SvgScanEntry[];
  /** Where the next page starts, or null after the last. */
  next: string | null;
}>;

function recordedVerdict(
  customMetadata?: Record<string, string>,
): string | null {
  const version = customMetadata?.[SVG_VALIDATOR_METADATA_KEY];
  if (version) return `v${version}`;
  if (customMetadata?.svgValidated === "true") return "legacy";
  return null;
}

type Judged =
  | { ok: true }
  | {
      ok: false;
      reason: SvgRefusal | "too-large";
      detail: string;
      line: number | null;
    };

async function judge(
  object: StoredObject,
): Promise<{ bytes: Uint8Array | null; verdict: Judged }> {
  if (object.size > MAX_SVG_BYTES) {
    return {
      bytes: null,
      verdict: {
        ok: false,
        reason: "too-large",
        detail: `${object.size} bytes; the library takes SVG up to ${MAX_SVG_BYTES}.`,
        line: null,
      },
    };
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const result = validateSvg(bytes);
  return {
    bytes,
    verdict: result.ok
      ? { ok: true }
      : {
          ok: false,
          reason: result.reason,
          detail: result.detail,
          line: result.line,
        },
  };
}

export async function scanLibrarySvgs(
  deps: SvgRevalidationDeps,
  input: { after: string | null; limit?: number },
): Promise<SvgScanPage> {
  const limit = Math.min(
    input.limit ?? SVG_REVALIDATION_BATCH,
    SVG_REVALIDATION_BATCH,
  );
  const assets = await deps.listSvgPage(input.after, limit);
  const entries: SvgScanEntry[] = [];
  for (const asset of assets) {
    const object = await deps.getObject(assetStorageKey(asset.url));
    if (!object) {
      entries.push({
        assetId: asset.id,
        name: asset.name,
        etag: null,
        status: "missing",
        recorded: null,
      });
      continue;
    }
    const recorded = recordedVerdict(object.customMetadata);
    if (passedCurrentSvgRules(object.customMetadata)) {
      entries.push({
        assetId: asset.id,
        name: asset.name,
        etag: object.etag,
        status: "current",
        recorded,
      });
      continue;
    }
    const { verdict } = await judge(object);
    entries.push(
      verdict.ok
        ? {
            assetId: asset.id,
            name: asset.name,
            etag: object.etag,
            status: "passes",
            recorded,
          }
        : {
            assetId: asset.id,
            name: asset.name,
            etag: object.etag,
            status: "refused",
            recorded,
            reason: verdict.reason,
            detail: verdict.detail,
            line: verdict.line,
          },
    );
  }
  return {
    entries,
    next: assets.length === limit ? assets[assets.length - 1]!.id : null,
  };
}

export type SvgRestoreOutcome = Readonly<{
  assetId: string;
  status: "restored" | "changed" | "refused" | "missing" | "write-failed";
  detail?: string;
}>;

export async function restoreLibrarySvgs(
  deps: SvgRevalidationDeps,
  items: ReadonlyArray<{ assetId: string; etag: string }>,
): Promise<SvgRestoreOutcome[]> {
  const outcomes: SvgRestoreOutcome[] = [];
  for (const { assetId, etag } of items.slice(0, SVG_REVALIDATION_BATCH)) {
    const asset = await deps.findAsset(assetId);
    if (!asset || asset.mimeType !== "image/svg+xml") {
      outcomes.push({ assetId, status: "missing" });
      continue;
    }
    const key = assetStorageKey(asset.url);
    const object = await deps.getObject(key);
    if (!object) {
      outcomes.push({ assetId, status: "missing" });
      continue;
    }
    if (object.etag !== etag) {
      outcomes.push({
        assetId,
        status: "changed",
        detail: "The file changed since the scan.",
      });
      continue;
    }
    const { bytes, verdict } = await judge(object);
    if (!verdict.ok || !bytes) {
      outcomes.push({
        assetId,
        status: "refused",
        detail: verdict.ok ? undefined : verdict.detail,
      });
      continue;
    }
    try {
      const written = await deps.putObject(key, bytes, {
        httpMetadata: object.httpMetadata,
        customMetadata: {
          ...object.customMetadata,
          [SVG_VALIDATOR_METADATA_KEY]: String(SVG_VALIDATOR_VERSION),
        },
        // Written only over the bytes just checked.
        onlyIf: { etagMatches: etag },
      });
      outcomes.push(
        written === null
          ? {
              assetId,
              status: "changed",
              detail: "The file changed while it was checked.",
            }
          : { assetId, status: "restored" },
      );
    } catch (error) {
      outcomes.push({
        assetId,
        status: "write-failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

export { SVG_REVALIDATION_BATCH };
