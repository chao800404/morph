import { listItems } from "@/actions/asset/list-items";
import AssetsCard from "@/app/(backend)/dashboard/_components/card/assets-card/assets-card";
import { AssetPropertyCard } from "@/app/(backend)/dashboard/_components/card/assets-card/client/asset-property-card";
import { getConfig } from "@/cms.config";
import { cn, formatDate, getFileExtension } from "@/lib/shared/utils";
import { notFound } from "next/navigation";
import { AssetDraggableProvider } from "./_component/draggable-provider";

export const Assets = async (props: PageArg) => {
    const config = getConfig();
    const searchParams = await props.searchParams;
    const folderId = searchParams?.folderId || null;
    const query = searchParams?.q;
    const sortBy = searchParams?.sortBy || "createdAt";
    const sortOrder = searchParams?.sortOrder || "desc";
    const page = Number(searchParams?.page) || 1;
    const limit = Number(searchParams?.limit) || 15;

    const queryResult = await listItems(
        folderId,
        query,
        sortBy as "name" | "createdAt" | "updatedAt",
        sortOrder as "asc" | "desc",
        page,
        limit
    );

    if (folderId && !queryResult.data?.currentFolder?.id) {
        notFound();
    }

    const foldersData =
        queryResult?.data?.folders?.map(folder => ({
            id: folder.id,
            name: folder.name,
            description: folder.description,
            createdAt: formatDate(folder.createdAt),
            updatedAt: formatDate(folder.updatedAt),
            createdBy: folder.createdBy || undefined,
            updatedBy: folder.updatedBy || undefined,
            empty: false,
        })) || [];

    const r2Domain = process.env.R2_DOMAIN || "http://localhost:8787";

    const assetsData =
        queryResult?.data?.assets?.map(asset => ({
            id: asset.id,
            name: asset.name,
            url: asset.url.startsWith("http") ? asset.url : `${r2Domain}${asset.url}`,
            createdAt: formatDate(new Date(asset.createdAt || new Date())),
            updatedAt: formatDate(new Date(asset.updatedAt || new Date())),
            size: asset.size,
            type: asset.mimeType,
            extension: getFileExtension(asset.name) || getFileExtension(asset.url),
            alt: asset.alt || undefined,
            caption: asset.caption || undefined,
            tags: asset.tags ? asset.tags.split(",").map((t: string) => t.trim()) : undefined,
            uploadedBy: asset.uploadedBy || undefined,
            duration: asset.duration || undefined,
        })) || [];

    const pagination = queryResult?.data?.pagination || {
        page: 1,
        limit: 20,
        totalAssets: 0,
        totalPages: 1,
    };

    const currentFolder = queryResult?.data?.currentFolder
        ? {
              id: queryResult.data.currentFolder.id,
              name: queryResult.data.currentFolder.name,
              createdAt: formatDate(queryResult.data.currentFolder.createdAt),
              updatedAt: formatDate(queryResult.data.currentFolder.updatedAt),
              createdBy: queryResult.data.currentFolder.createdBy || undefined,
              updatedBy: queryResult.data.currentFolder.updatedBy || undefined,
              empty: false,
              idPath: queryResult.data.currentFolder.idPath,
              path: queryResult.data.currentFolder.path,
              parentId: queryResult.data.currentFolder.parentId,
              description: queryResult.data.currentFolder.description,
          }
        : undefined;

    // 準備預覽資產列表
    const previewAssets = assetsData.map(asset => ({
        id: String(asset.id),
        type: "asset" as const,
        name: asset.name,
        fileType: asset.type?.startsWith("image/") ? "image" : asset.type?.startsWith("video/") ? "video" : "file",
        extension: asset.extension,
        src: asset.url,
        alt: asset.alt,
        duration: asset.duration,
        size: asset.size,
        caption: asset.caption || undefined,
        tags: asset.tags,
        uploadedBy: asset.uploadedBy || undefined,
    }));

    return (
        <>
            <section className={cn("w-[calc(100%-23.2rem)]", "max-xl:w-full")}>
                <div className="px-2 py-3">
                    <AssetDraggableProvider>
                        <AssetsCard
                            folderId={folderId}
                            query={query}
                            data={{
                                folders: foldersData,
                                assets: assetsData,
                                currentFolder,
                                pagination,
                            }}
                            uploadConfig={config.server.upload}
                        />
                    </AssetDraggableProvider>
                </div>
            </section>
            <div className="bottom-0 w-sm p-3 fixed top-14 right-3 max-lg:hidden">
                <div className="h-full">
                    <AssetPropertyCard />
                </div>
            </div>
        </>
    );
};

export default Assets;
