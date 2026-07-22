import type { FormField } from "@/lib/validations/form";
import { sanitizeString, validateFormField, validateReactNode } from "@/lib/validations/form";
import { JSX } from "react";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField } from "@/lib/validations/form";

// Form state for server actions
export interface FormState {
    message: string;
    success?: boolean;
    errors?: Record<string, string[]>;
}

// Server action: follows React 19 useActionState signature
export type ServerAction = any;

interface InfoState {
    open: boolean;
    title?: string;
    description?: string;
    reactNode?: React.ReactNode;
    fields?: FormField[]; // Used for hidden fields to pass data like IDs
    action?: ServerAction;
    onSuccess?: () => void; // Callback after successful action
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "form" | "formDark";
    toggleOpen: () => void;
    handleOpenChange: (open: boolean) => void;
    setOpen: (open: boolean) => void;
    setInfoData: (data: {
        title?: string;
        description?: string;
        fields?: FormField[];
        action?: ServerAction;
        onSuccess?: () => void;
        reactNode?: JSX.Element;
        confirmLabel?: string;
        cancelLabel?: string;
        confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "form" | "formDark";
    }) => void;
}

const initialState = {
    open: false,
    title: undefined,
    description: undefined,
    fields: undefined,
    action: undefined,
    onSuccess: undefined,
    reactNode: undefined,
    confirmLabel: "Continue",
    cancelLabel: "Cancel",
    confirmVariant: "destructive" as const,
};

export const useInfoStore = create<InfoState>((set, get) => ({
    ...initialState,
    toggleOpen: () => {
        const { open } = get();
        if (open) {
            // If closing, reset to initial state
            set(initialState);
        } else {
            // If opening, just set open to true
            set({ open: true });
        }
    },
    handleOpenChange: (open: boolean) => {
        if (!open) {
            set(initialState);
        } else {
            set({ open: true });
        }
    },
    setOpen: (open: boolean) => {
        if (!open) {
            set(initialState);
        } else {
            set({ open: true });
        }
    },
    setInfoData: (data: {
        title?: string;
        description?: string;
        fields?: FormField[];
        action?: ServerAction;
        onSuccess?: () => void;
        reactNode?: JSX.Element;
        confirmLabel?: string;
        cancelLabel?: string;
        confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "form" | "formDark";
    }) => {
        // Sanitize title and description (allow punctuation, just remove XSS vectors)
        // We bypass validateFormSchema for title/description because safeDescriptionSchema is too strict for dialog messages (e.g. doesn't allow '?')
        const title = data.title ? sanitizeString(data.title) : undefined;
        const description = data.description ? sanitizeString(data.description) : undefined;

        // Validate fields
        let validFields: FormField[] | undefined = undefined;
        if (data.fields) {
            validFields = data.fields.map(f => validateFormField(f)).filter((f): f is FormField => f !== null);
        }

        // Validate ReactNode
        let validReactNode: React.ReactNode | undefined = undefined;
        if (data.reactNode !== undefined) {
            if (validateReactNode(data.reactNode)) {
                validReactNode = data.reactNode;
            } else {
                console.warn("Invalid ReactNode provided, ignoring it");
            }
        }

        set(state => ({
            title: title ?? state.title,
            description: description ?? state.description,
            fields: validFields ?? state.fields,
            action: data.action ?? state.action,
            onSuccess: data.onSuccess ?? state.onSuccess,
            reactNode: validReactNode ?? state.reactNode,
            confirmLabel: data.confirmLabel ?? state.confirmLabel,
            cancelLabel: data.cancelLabel ?? state.cancelLabel,
            confirmVariant: data.confirmVariant ?? state.confirmVariant,
        }));
    },
}));
