import { AssetEmptyCard } from "@/app/(backend)/dashboard/_components/card/assets-card/client/asset-empty-card";
import { AssetsCardHeader } from "@/app/(backend)/dashboard/_components/card/assets-card/client/assets-card-header.client";
import { AssetsContent } from "@/app/(backend)/dashboard/_components/card/assets-card/client/assets-content.client";
import { FoldersContent } from "@/app/(backend)/dashboard/_components/card/assets-card/client/folders-content.client";
import { CardWrapper } from "@/app/(backend)/dashboard/_components/card/card-wrapper";

import { BreadcrumbCollapse } from "@/app/(backend)/dashboard/_components/breadcrumb/breadcrumb-collapse";
import { cn } from "@/lib/utils";
import type { AssetsCardComponentProps } from "../_config/assets-card.types";

export const AssetsExplorerCard = ({
    slug,
    label,
    description,
    data,
    query,
    uploadConfig,
}: AssetsCardComponentProps) => {
    const { folders = [], assets = [], currentFolder } = data;
    const breadCrumb = currentFolder?.idPath?.split("/").filter(Boolean);

    const rootBreadcrumb = [{ label, href: "/dashboard/assets" }];
    let breadcrumbs = rootBreadcrumb;

    if (breadCrumb && breadCrumb?.length > 0) {
        const namePath = currentFolder?.path?.split("/").filter(Boolean);
        const filteredBreadCrumb = breadCrumb.filter(Boolean);

        breadcrumbs = [
            ...rootBreadcrumb,
            ...filteredBreadCrumb.map((item, idx) => ({
                label: namePath?.[idx] || "Unknown",
                href: `/dashboard/assets?folderId=${item}`,
            })),
        ];
    }

    if (folders?.length <= 0 && assets?.length <= 0 && !currentFolder && !query)
        return (
            <div id={slug}>
                <CardWrapper
                    classNames={{ cardWrapper: "h-[calc(100svh-5rem)]", contentWrapper: "h-full w-full relative" }}
                    label={<BreadcrumbCollapse breadcrumbs={breadcrumbs} />}
                    description={description}
                >
                    <AssetEmptyCard showButton uploadConfig={uploadConfig} />
                </CardWrapper>
            </div>
        );

    return (
        <CardWrapper
            classNames={{
                contentWrapper: cn("h-full w-full relative"),
                headerWrapper: cn("max-md:flex-col"),
            }}
            label={<BreadcrumbCollapse breadcrumbs={breadcrumbs} />}
            description={description}
            headerButton={
                <AssetsCardHeader
                    className="max-md:w-full max-md:flex-1"
                    id="assets-card-header"
                    data={data}
                    uploadConfig={uploadConfig}
                />
            }
        >
            <div className="h-full w-full">
                {folders?.length <= 0 && assets?.length <= 0 && (
                    <div className="h-92 w-full flex items-center gap-4 justify-center flex-col">
                        <AssetEmptyCard className="h-fit" showButton={false} />
                        <p className="text-center">No assets found</p>
                    </div>
                )}
                {folders && folders?.length > 0 && <FoldersContent folders={folders} />}
                <AssetsContent assets={assets} pagination={data.pagination} />
            </div>
        </CardWrapper>
    );
};
