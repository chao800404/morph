"use client";

import { useInfoStore } from "@/app/(backend)/dashboard/_features/global-info/use-info-store";
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
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { FieldsRenderer } from "../../_components/form/fields-renderer";

const InfoAlertForm = () => {
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
        useShallow(state => ({
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
        }))
    );

    const [isExecuting, setIsExecuting] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!action) return;

        const formData = new FormData(e.currentTarget);
        setIsExecuting(true);

        const promise = (async () => {
            const result = await action(formData);

            if (result.serverError) {
                throw new Error(result.serverError);
            }

            // Check for explicit success: false or missing success with error message
            if (
                result.data?.success === false ||
                (!result.data?.success && result.data?.message && !result.data?.redirectPath)
            ) {
                throw new Error(result.data?.message || "Operation failed");
            }

            return result.data;
        })();

        toast.promise(promise, {
            loading: "Processing...",
            success: data => {
                onSuccess?.();
                handleOpenChange(false);
                return data?.message || "Success";
            },
            error: err => {
                setIsExecuting(false);
                return err.message || "An error occurred";
            },
            position: "top-center",
        });
    };

    return (
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{title || "Are you sure?"}</AlertDialogTitle>
                <AlertDialogDescription>{description || "This action cannot be undone."}</AlertDialogDescription>
            </AlertDialogHeader>

            <form onSubmit={handleSubmit}>
                <FieldsRenderer fields={fields || []} />
                {reactNode}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isExecuting}>{cancelLabel || "Cancel"}</AlertDialogCancel>
                    <Button variant={confirmVariant || "destructive"} type="submit" disabled={isExecuting}>
                        {isExecuting ? "Processing..." : confirmLabel || "Continue"}
                    </Button>
                </AlertDialogFooter>
            </form>
        </AlertDialogContent>
    );
};

export const InfoAlert = () => {
    const { open, handleOpenChange } = useInfoStore(
        useShallow(state => ({
            open: state.open,
            handleOpenChange: state.handleOpenChange,
        }))
    );

    return (
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
            {open && <InfoAlertForm />}
        </AlertDialog>
    );
};
