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
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useInfoStore } from "./use-info-store";

const InfoAlertForm = () => {
  const router = useRouter();
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
    })),
  );

  const [isExecuting, setIsExecuting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!action) return;

    const formData = new FormData(e.currentTarget);
    setIsExecuting(true);

    try {
      const result = await action(formData);

      if (result.serverError) {
        throw new Error(result.serverError);
      }

      if (result.success === false) {
        throw new Error(result.message || "Operation failed");
      }

      // Action successful
      onSuccess?.();
      handleOpenChange(false);

      // Only show toast if there's a message
      if (result.message) {
        toast.success(result.message);
      }
    } catch (err: any) {
      // Handle TanStack Start validation error format if it's JSON
      let errorMessage = err.message || "An error occurred";
      try {
        const parsed = JSON.parse(err.message);
        if (Array.isArray(parsed) && parsed[0]?.message) {
          errorMessage = parsed[0].message;
        }
      } catch (e) {
        // Fallback to original
      }
      toast.error(errorMessage);
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
