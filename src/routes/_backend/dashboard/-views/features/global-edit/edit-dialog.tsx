import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import { useRouter } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useInfoStore } from "../global-info/use-info-store";
import { useEditStore } from "./use-edit-store";

import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { DialogHeaderActions } from "@/components/dialog/dialog-header-actions";
import {
  FieldsRenderer,
  type FirstFieldRefTarget,
} from "@/components/form/fields-renderer";

export const EditDialog = () => {
  const firstFieldRef = useRef<FirstFieldRefTarget>(null);
  const router = useRouter();
  const {
    open,
    handleOpenChange,
    title,
    action,
    fields,
    initialFields,
    updateFieldValue,
    onSuccess,
  } = useEditStore(
    useShallow((state) => ({
      open: state.open,
      handleOpenChange: state.handleOpenChange,
      title: state.title,
      fields: state.fields,
      initialFields: state.initialFields,
      updateFieldValue: state.updateFieldValue,
      onSuccess: state.onSuccess,
      action: state.action,
    })),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  // Check if form is dirty with useMemo
  const isDirty = useMemo(() => {
    if (!fields || !initialFields) return false;
    if (fields.length !== initialFields.length) return true;
    return fields.some((f, i) => f.value !== initialFields[i]?.value);
  }, [fields, initialFields]);

  const handleOpenChangeWrapper = (newOpen: boolean) => {
    if (!newOpen && isDirty) {
      setInfoData({
        title: "Unsaved Changes",
        description:
          "You have unsaved changes. Are you sure you want to discard them?",
        confirmLabel: "Discard",
        confirmVariant: "destructive",
        action: async () => ({ message: "", success: true }),
        onSuccess: () => {
          handleOpenChange(false);
        },
      });
      setInfoOpen(true);
      return;
    }
    handleOpenChange(newOpen);
  };

  const [isExecuting, setIsExecuting] = useState(false);

  const handleSubmit = async (_: FormData) => {
    if (!action) return;

    setIsExecuting(true);

    // Create a new FormData object from the current fields state
    // This ensures we use the values from controlled components (like phone input)
    // rather than the raw form data which might be incorrect or unformatted
    const submitFormData = new FormData();
    fields?.forEach((field) => {
      if (field.value !== undefined && field.value !== null) {
        submitFormData.append(field.name, String(field.value));
      }
    });

    const promise = (async () => {
      try {
        const result = await action(submitFormData);
        if (!result.success) throw new Error(result.message);
        return result;
      } catch (error) {
        throw new Error(getActionErrorMessage(error, "Failed to save changes"));
      }
    })();

    toast.promise(promise, {
      loading: "Saving...",
      success: (result) => {
        onSuccess?.();
        handleOpenChange(false);
        router.invalidate();
        setIsExecuting(false);
        return result.message || "Saved successfully";
      },
      error: (err) => {
        setIsExecuting(false);
        return err.message || "An error occurred";
      },
      position: "top-center",
    });
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChangeWrapper}>
      <SheetContent
        className={cn(
          "bg-transparent border-l-0 p-2 shadow-none",
          "sm:max-w-4xl max-sm:w-full",
        )}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => {
            // The ref target depends on which field type renders first. The
            // phone control's instance type does not declare `focus`, so probe
            // for it instead of asserting a DOM element.
            const target = firstFieldRef.current;
            if (target && "focus" in target && typeof target.focus === "function") {
              target.focus();
            }
          }, 0);
        }}
      >
        <SheetTitle className="sr-only">{title || "Edit"}</SheetTitle>
        <SheetDescription className="sr-only">
          Edit information for {title}
        </SheetDescription>
        <AnimatePresence>
          {open && (
            <motion.div
              className="shadow-sm/20 border flex flex-col overflow-hidden bg-component h-full dark:shadow-elevation-modal rounded-lg"
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: "keyframes" }}
            >
              <DialogHeaderActions
                onClose={() => handleOpenChangeWrapper(false)}
                title={title || "Edit"}
              />
              <form
                action={handleSubmit}
                className={cn(
                  "flex flex-col flex-1 min-h-0 relative z-20",
                  "dark:shadow-elevation-modal dark:border-border/30 dark:bg-component",
                )}
              >
                {fields && fields.length > 0 ? (
                  <>
                    <ScrollArea
                      className={cn(
                        "w-full border-b flex-1 min-h-0 relative z-20 bg-component border-ring/20",
                        "dark:shadow-elevation-modal dark:border-border/30",
                      )}
                    >
                      <ScrollBar />
                      <div className="p-5 pb-10 max-w-full relative z-50">
                        <FieldsRenderer
                          fields={fields}
                          firstFieldRef={firstFieldRef}
                          onChange={(name, value) => {
                            if (typeof value === "string") {
                              updateFieldValue(name, value);
                            }
                          }}
                        />
                      </div>
                    </ScrollArea>
                    <DialogFooterActions
                      isLoading={isExecuting}
                      isDisabled={!isDirty}
                      onCancel={() => handleOpenChangeWrapper(false)}
                      submitLabel="Save"
                      loadingLabel="Saving..."
                    />
                  </>
                ) : (
                  <div className="text-center h-full flex items-center justify-center text-muted-foreground">
                    <p>No fields</p>
                  </div>
                )}
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
};
