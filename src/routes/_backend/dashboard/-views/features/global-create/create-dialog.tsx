import {
  DialogCreateWrapper,
  type ActionState,
  type FormAction,
} from "@/components/dialog/dialog-create-wrapper";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { useCallback } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { useUploadStore } from "@/components/upload/_store/upload.store";
import {
  getActionErrorMessage,
  type AssetActionResult,
} from "@/lib/asset/action-result";
import { useCreateStore } from "./use-create-store";

export const CreateDialog = () => {
  const {
    open,
    handleOpenChange,
    title,
    description,
    fields,
    action,
    onSuccess,
  } = useCreateStore(
    useShallow((state: any) => ({
      open: state.open,
      handleOpenChange: state.handleOpenChange,
      title: state.title,
      description: state.description,
      fields: state.fields,
      action: state.action,
      onSuccess: state.onSuccess,
    })),
  );

  const { fileData, clearAll, setError } = useUploadStore(
    useShallow((state: any) => ({
      fileData: state.fileData,
      clearAll: state.clearAll,
      setError: state.setError,
    })),
  );

  // Wrap action to add validation and file handling
  const wrappedAction: FormAction = useCallback(
    async (
      _prevState: ActionState,
      formData: FormData,
    ): Promise<ActionState> => {
      // Add upload files from Zustand store with duration
      let fileIndex = 0;
      const durations: Array<number | null> = [];
      for (const [name, fileWithPreviews] of Object.entries(fileData)) {
        if (Array.isArray(fileWithPreviews)) {
          for (const { file, duration } of fileWithPreviews as any[]) {
            formData.append(name, file);

            // Add duration if available (already extracted in upload-field)
            if (duration !== undefined && duration > 0) {
              durations[fileIndex] = duration;
            } else {
              durations[fileIndex] = null;
            }
            fileIndex++;
          }
        }
      }

      if (durations.length > 0) {
        formData.set("durations", JSON.stringify(durations));
      }

      if (action) {
        const toastId = toast.loading("Processing...", {
          position: "top-center",
        });

        try {
          const actionResult = await action({ data: formData });

          if (!actionResult.success) {
            console.error("❌ [CreateDialog Action Failed]", {
              message: actionResult.message,
              errors: actionResult.errors,
            });

            if (actionResult.errors) {
              Object.entries(actionResult.errors).forEach(([key, messages]) => {
                if (
                  fileData[key] &&
                  Array.isArray(messages) &&
                  messages.length > 0
                ) {
                  setError(key, messages[0]);
                }
              });
            }

            toast.error(actionResult.message || "Operation failed", {
              id: toastId,
              position: "top-center",
            });
            return actionResult;
          }

          clearAll();
          handleOpenChange(false);
          toast.success(actionResult.message || "Success!", {
            id: toastId,
            position: "top-center",
          });

          try {
            await onSuccess?.();
          } catch (refreshError) {
            // The item was already created successfully. A refresh failure must
            // not be presented to the user as an upload failure.
            console.warn("Failed to refresh after create:", refreshError);
          }

          return actionResult as ActionState;
        } catch (error) {
          const actionError = error as Error & { data?: AssetActionResult };
          const message = getActionErrorMessage(actionError);
          console.error("❌ [CreateDialog Exception]", { error, message });
          toast.error(message, {
            id: toastId,
            position: "top-center",
          });

          return {
            success: false,
            message,
            errors: actionError.data?.errors,
          };
        }
      }

      return {
        success: false,
        message: "No action provided",
      };
    },
    [action, fileData, onSuccess, handleOpenChange, clearAll, setError],
  );

  return (
    <DialogCreateWrapper
      onOpenChange={(open) => {
        if (!open) {
          handleOpenChange(open);
          // Clear upload store when dialog closes
          clearAll();
        }
      }}
      open={open}
      action={wrappedAction}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const content = event.target as HTMLElement | null;
        const autoFocusTarget = (
          content ?? document.body
        )?.querySelector<HTMLElement>("[data-auto-focus='true']");
        if (autoFocusTarget) {
          requestAnimationFrame(() => autoFocusTarget.focus());
        }
      }}
    >
      <h2 className="text-md font-medium">{title}</h2>
      {description ? (
        <p className="text-base text-zinc-500">{description}</p>
      ) : null}
      {fields && (
        <FieldsRenderer
          fields={fields}
          onChange={useCreateStore.getState().updateFieldValue}
          className="mt-8 grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2"
        />
      )}
    </DialogCreateWrapper>
  );
};
