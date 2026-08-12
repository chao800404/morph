import { FieldsRenderer } from "@/components/form/fields-renderer";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useInfoStore } from "./use-info-store";

const InfoAlertForm = () => {
  const queryClient = useQueryClient();
  const {
    handleOpenChange,
    title,
    description,
    fields,
    action,
    onSuccess,
    reactNode,
    confirmLabel,
    cancelLabel,
    confirmVariant,
    setInfoData,
  } = useInfoStore(
    useShallow((state) => ({
      handleOpenChange: state.handleOpenChange,
      title: state.title,
      description: state.description,
      fields: state.fields,
      action: state.action,
      onSuccess: state.onSuccess,
      reactNode: state.reactNode,
      confirmLabel: state.confirmLabel,
      cancelLabel: state.cancelLabel,
      confirmVariant: state.confirmVariant,
      setInfoData: state.setInfoData,
    })),
  );

  const [isExecuting, setIsExecuting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!action) return;

    const formData = new FormData(e.currentTarget);
    setIsExecuting(true);

    try {
      const result = await action({ data: formData });

      if (result.requiresConfirmation) {
        setInfoData({
          description:
            result.description ??
            "This item is in use. Confirm to remove its references and delete it.",
          fields: [
            ...(fields ?? []).filter(
              (field) => field.name !== "detachReferences",
            ),
            {
              type: "hidden",
              name: "detachReferences",
              value: "true",
            },
          ],
          confirmLabel: "Remove references and delete",
        });
        return;
      }

      if (result.success === false) {
        throw new Error(result.message || "Operation failed");
      }

      // The asset query is the single client-side source of truth.
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["product-variants"] });

      onSuccess?.();
      handleOpenChange(false);

      // Only show toast if there's a message
      if (result.message) {
        toast.success(result.message);
      }
    } catch (error) {
      toast.error(getActionErrorMessage(error, "An error occurred"));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title || "Are you sure?"}</AlertDialogTitle>
        <AlertDialogDescription>
          {description || "This action cannot be undone."}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <form onSubmit={handleSubmit}>
        <FieldsRenderer fields={fields || []} />
        {reactNode}
        <AlertDialogFooter className="mt-6">
          <AlertDialogCancel disabled={isExecuting}>
            {cancelLabel || "Cancel"}
          </AlertDialogCancel>
          <Button
            variant={
              confirmVariant === "destructive" ? "destructive" : "default"
            }
            type="submit"
            disabled={isExecuting}
          >
            {isExecuting ? "Processing..." : confirmLabel || "Continue"}
          </Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  );
};

export const InfoAlert = () => {
  const { open, handleOpenChange } = useInfoStore(
    useShallow((state) => ({
      open: state.open,
      handleOpenChange: state.handleOpenChange,
    })),
  );

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {open && <InfoAlertForm />}
    </AlertDialog>
  );
};
