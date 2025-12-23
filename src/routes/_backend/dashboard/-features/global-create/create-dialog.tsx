"use client";

import {
  DialogCreateWrapper,
  type ActionState,
  type FormAction,
} from "@/components/dialog/dialog-create-wrapper";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { useCallback } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

// TODO: These stores are currently missing in the workspace migration.
// They should be moved to @/hooks or @/routes/_backend/dashboard/-stores/
// Mocking them temporarily to avoid build errors.
const useUploadStore: any = () => ({
  fileData: {},
  clearAll: () => {},
  setError: () => {},
});
const useCreateStore: any = () => ({
  open: false,
  handleOpenChange: () => {},
  title: "",
  description: "",
  fields: [],
  action: null,
  onSuccess: null,
});

const initialFormState: ActionState = {
  message: "",
  success: undefined,
};

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
      prevState: ActionState,
      formData: FormData,
    ): Promise<ActionState> => {
      // Add upload files from Zustand store with duration
      let fileIndex = 0;
      for (const [name, fileWithPreviews] of Object.entries(fileData)) {
        if (Array.isArray(fileWithPreviews)) {
          for (const { file, duration } of fileWithPreviews as any[]) {
            formData.append(name, file);

            // Add duration if available (already extracted in upload-field)
            if (duration !== undefined && duration > 0) {
              formData.append(`duration_${fileIndex}`, duration.toString());
            }
            fileIndex++;
          }
        }
      }

      // Call the actual action
      if (action) {
        const promise = (async () => {
          const actionResult = await (action as any)(formData);

          if (actionResult.serverError) {
            throw new Error(actionResult.serverError);
          }

          if (!actionResult.data?.success) {
            const error = new Error(
              actionResult.data?.message || "Operation failed",
            );
            (error as any).data = actionResult.data;
            throw error;
          }

          return actionResult.data;
        })();

        toast.promise(promise, {
          loading: "Processing...",
          success: (data: any) => {
            clearAll();
            onSuccess?.();
            handleOpenChange(false);
            return data?.message || "Success!";
          },
          error: (error: any) => {
            if (error.data?.errors) {
              Object.entries(error.data.errors).forEach(([key, messages]) => {
                if (
                  fileData[key] &&
                  Array.isArray(messages) &&
                  messages.length > 0
                ) {
                  setError(key, (messages as string[])[0]);
                }
              });
            }
            return error.message;
          },
          position: "top-center",
        });

        try {
          return (await promise) as ActionState;
        } catch (error: any) {
          return {
            success: false,
            message: error.message,
            errors: error.data?.errors,
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
          className="mt-8 grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2"
        />
      )}
    </DialogCreateWrapper>
  );
};
