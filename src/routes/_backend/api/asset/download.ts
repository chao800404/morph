import { createAuth } from "@/auth";
import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { hasAnyRole } from "@/server/middleware/auth.middleware";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import { bulkOperationLimits } from "@/lib/db/operation-limits";
import { getConfig } from "@/server/get-config";
import pLimit from "p-limit";
import { z } from "zod";
import type { AssetDTO } from "@/lib/asset/dto/asset.dto";

const safeDownloadName = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f"\\/]/g, "_").slice(0, 255) || "download";
const requestedIdsSchema = z.array(z.uuid()).max(100);

export const Route = createFileRoute("/_backend/api/asset/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session = null;
        try {
          const auth = createAuth(env);
          session = await auth.api.getSession({ headers: request.headers });
        } catch {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        if (!session?.user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        if (!hasAnyRole(session.user.role, ["admin", "user"])) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const mode = searchParams.get("mode");
        const singleAssetId = searchParams.get("assetId");
        const assetIdsParam = searchParams.get("assetIds");
        const folderIdsParam = searchParams.get("folderIds");

        // Single asset direct file download
        if (!mode && singleAssetId) {
          const parsedAssetId = z.uuid().safeParse(singleAssetId);
          if (!parsedAssetId.success) {
            return new Response("Invalid asset ID", { status: 400 });
          }
          const asset = await assetDal.findById(parsedAssetId.data);
          if (!asset) {
            return new Response("Asset not found", { status: 404 });
          }

          const rawKey = asset.url.replace(/^\/+/, "");
          const key = rawKey.startsWith("assets/")
            ? rawKey
            : `assets/${rawKey}`;
          const object = await env.R2_BUCKET.get(key);
          if (!object) {
            return new Response("File not found in storage", { status: 404 });
          }

          const headers = new Headers();
          object.writeHttpMetadata(headers);
          const filename = safeDownloadName(asset.originalName || asset.name);
          const encodedFilename = encodeURIComponent(filename);
          headers.set(
            "content-disposition",
            `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
          );
          headers.set("etag", object.httpEtag);
          headers.set("cache-control", "private, max-age=3600");
          headers.set("x-content-type-options", "nosniff");

          return new Response(object.body, { headers });
        }

        // Bulk / Manifest list mode for zip download
        const parsedAssetIds = requestedIdsSchema.safeParse(
          assetIdsParam
            ? assetIdsParam
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        );
        const parsedFolderIds = requestedIdsSchema.safeParse(
          folderIdsParam
            ? folderIdsParam
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        );
        if (!parsedAssetIds.success || !parsedFolderIds.success) {
          return new Response(
            JSON.stringify({ error: "Invalid download item IDs" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const assetIds = parsedAssetIds.data;
        const folderIds = parsedFolderIds.data;

        if (assetIds.length + folderIds.length > 100) {
          return new Response(
            JSON.stringify({
              error: "A maximum of 100 items may be downloaded at once",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        if (assetIds.length === 0 && folderIds.length === 0) {
          return new Response(
            JSON.stringify({ error: "No items requested for download" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        // Collect folder IDs (including descendants). Concurrency is capped so
        // a large selection cannot open one simultaneous D1 query per folder.
        const allFolderIds = new Set<string>(folderIds);
        const descendantLookups = pLimit(DB_FANOUT_CONCURRENCY);
        await Promise.all(
          folderIds.map((fId) =>
            descendantLookups(async () => {
              const descendants =
                await assetFolderDal.findAllDescendantIds(fId);
              descendants.forEach((id) => allFolderIds.add(id));
            }),
          ),
        );

        // Fetch folders to build path lookup
        const folderList = await assetFolderDal.findByIds(
          Array.from(allFolderIds),
        );
        const folderMap = new Map(folderList.map((f) => [f.id, f]));

        // Collect target assets with ZIP-relative paths
        const targetAssetsMap = new Map<
          string,
          { asset: AssetDTO; relativePath: string }
        >();

        // Direct assets
        if (assetIds.length > 0) {
          const directAssets = await assetDal.findByIds(assetIds);
          for (const asset of directAssets) {
            const filename = safeDownloadName(asset.originalName || asset.name);
            targetAssetsMap.set(asset.id, { asset, relativePath: filename });
          }
        }

        // Assets inside folders
        if (allFolderIds.size > 0) {
          const folderAssets = await assetDal.findByFolderIds(
            Array.from(allFolderIds),
          );
          for (const asset of folderAssets) {
            if (!targetAssetsMap.has(asset.id)) {
              let folderPathPrefix = "";
              if (asset.folderId && folderMap.has(asset.folderId)) {
                const folder = folderMap.get(asset.folderId)!;
                folderPathPrefix =
                  folder.path
                    .split("/")
                    .filter(Boolean)
                    .map(safeDownloadName)
                    .join("/") + "/";
              }
              const filename = safeDownloadName(
                asset.originalName || asset.name,
              );
              targetAssetsMap.set(asset.id, {
                asset,
                relativePath: `${folderPathPrefix}${filename}`,
              });
            }
          }
        }

        // The browser fetches every file in the manifest to build the ZIP, so
        // an unbounded folder would leave it downloading for minutes with no
        // way to tell whether it stalled. Refuse up front instead.
        const limits = bulkOperationLimits(
          getConfig().server.cloudflare?.plan,
        );
        if (targetAssetsMap.size > limits.maxAssets) {
          return new Response(
            JSON.stringify({
              error: `This selection contains ${targetAssetsMap.size} files, above the limit of ${limits.maxAssets} per download. Download the folders separately.`,
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const fileItems = Array.from(targetAssetsMap.values()).map(
          ({ asset, relativePath }) => {
            const rawUrl = asset.url.replace(/^\/+/, "");
            const key = rawUrl.startsWith("assets/")
              ? rawUrl
              : `assets/${rawUrl}`;
            return {
              id: asset.id,
              name: safeDownloadName(asset.originalName || asset.name),
              path: relativePath,
              downloadUrl: `/${key}`,
              size: asset.size,
            };
          },
        );

        let zipName = "download.zip";
        if (
          folderIds.length === 1 &&
          assetIds.length === 0 &&
          folderList.length > 0
        ) {
          const mainFolder = folderList.find((f) => f.id === folderIds[0]);
          if (mainFolder) {
            zipName = `${safeDownloadName(mainFolder.name)}.zip`;
          }
        }

        return new Response(
          JSON.stringify({
            zipName,
            files: fileItems,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
  },
});
