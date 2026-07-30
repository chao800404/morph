import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { appendUploadFiles } from "@/components/upload/append-upload-files";
import { useUploadStore } from "@/components/upload/_store/upload.store";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import { createItems } from "@/server/asset/create-items.serverFn";
import { assetQueries } from "@queries/asset.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  getAssetCreateConfig,
  toAssetCreateVariant,
} from "./config/asset-create.config";

/**
 * Create page for Assets, serving both variants it offers.
 *
 * `?variant=folder` creates a folder and `?variant=upload` uploads files. The folder
 * being viewed is already `?folderId` on the list route, and this page is a
 * child of it, so the destination folder comes from the URL rather than from
 * page state — which also makes "upload into this folder" a shareable link.
 */
const AssetCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const search = useSearch({ strict: false }) as DashboardSearch;

  const { fileData, clearAll, setError } = useUploadStore(
    useShallow((state) => ({
      fileData: state.fileData,
      clearAll: state.clearAll,
      setError: state.setError,
    })),
  );

  const variant = toAssetCreateVariant(search.variant);

  const dialog = useMemo(() => {
    const { upload } = getConfig().client;
    const config = getAssetCreateConfig(variant, upload);

    // The folder in view is the one being created into, unless the user picks
    // another in the field.
    return {
      ...config,
      fields: config.fields.map((field) =>
        field.name === "parent-id" && search.folderId
          ? { ...field, defaultValue: String(search.folderId) }
          : field,
      ),
    };
  }, [variant, search.folderId]);

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    appendUploadFiles(formData, fileData);

    try {
      const result = await createItems({ data: formData });

      if (!result.success) {
        // Field errors that belong to an upload field are shown on the field
        // itself; the toast carries the summary.
        if (result.errors) {
          for (const [key, messages] of Object.entries(result.errors)) {
            if (fileData[key] && messages?.length) setError(key, messages[0]);
          }
        }
        toast.error(result.message, { position: "top-center" });
        return result;
      }

      clearAll();
      await queryClient.invalidateQueries({ queryKey: assetQueries.all() });
      toast.success(result.message, { position: "top-center" });
      close();
      return result;
    } catch (error) {
      const message = getActionErrorMessage(error);
      toast.error(message, { position: "top-center" });
      return { success: false, message };
    }
  };

  return (
    <RouteFormPage
      title={dialog.title}
      description={dialog.description}
      fields={dialog.fields}
      action={submit}
      submitLabel="Create"
      loadingLabel="Creating..."
      fieldsClassName={dialog.gridClassName}
    />
  );
};

export default AssetCreate;
