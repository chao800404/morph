"use client";

import dynamic from "next/dynamic";

const AssetEditDialog = dynamic(
    () => import("@/app/(backend)/dashboard/_features/asset/edit/asset-edit-dialog").then(mod => mod.AssetEditDialog),
    { ssr: false }
);
const AssetMoveDialog = dynamic(
    () => import("@/app/(backend)/dashboard/_features/asset/move/asset-move-dialog").then(mod => mod.AssetMoveDialog),
    { ssr: false }
);
const AssetPostProcessDialog = dynamic(
    () =>
        import("@/app/(backend)/dashboard/_features/asset/post-process/asset-post-process-dialog").then(
            mod => mod.AssetPostProcessDialog
        ),
    { ssr: false }
);
const AssetPreviewDialog = dynamic(
    () =>
        import("@/app/(backend)/dashboard/_features/asset/preview/asset-preview-dialog").then(
            mod => mod.AssetPreviewDialog
        ),
    { ssr: false }
);
const AssetSelectFloat = dynamic(() => import("@/app/(backend)/dashboard/_features/asset/select/float"), {
    ssr: false,
});

const AssetDetailDialog = dynamic(
    () =>
        import("@/app/(backend)/dashboard/_features/asset/detail/asset-detail-dialog").then(
            mod => mod.AssetDetailDialog
        ),
    { ssr: false }
);

export const AssetsDialogs = () => {
    return (
        <>
            <AssetEditDialog />
            <AssetMoveDialog />
            <AssetPostProcessDialog />
            <AssetPreviewDialog />
            <AssetSelectFloat />
            {/* <AssetDetailDialog /> */}
        </>
    );
};
