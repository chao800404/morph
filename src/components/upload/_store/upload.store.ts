import { create } from "zustand";

export interface FileWithPreview {
    file: File;
    preview: string;
    duration?: number; // Duration in seconds for video files
}

interface UploadState {
    fileData: Record<string, FileWithPreview[]>;
    errors: Record<string, string | null>;
    setFileData: (fieldName: string, files: FileWithPreview[]) => void;
    removeFile: (fieldName: string, index: number) => void;
    setError: (fieldName: string, error: string | null) => void;
    clearFiles: (fieldName: string) => void;
    clearAll: () => void;
}

const EMPTY_ARRAY: FileWithPreview[] = [];

export const useUploadStore = create<UploadState>((set, get) => ({
    fileData: {},
    errors: {},
    setFileData: (fieldName, files) =>
        set(state => ({
            fileData: { ...state.fileData, [fieldName]: files },
            errors: { ...state.errors, [fieldName]: null }, // Clear error when files are set
        })),
    removeFile: (fieldName, index) =>
        set(state => {
            const files = state.fileData[fieldName] || [];
            const removed = files[index];
            if (removed) {
                // Revoke the URL for the removed file
                URL.revokeObjectURL(removed.preview);
            }
            const newFiles = files.filter((_, i) => i !== index);
            return {
                fileData: { ...state.fileData, [fieldName]: newFiles },
            };
        }),
    setError: (fieldName, error) =>
        set(state => ({
            errors: { ...state.errors, [fieldName]: error },
        })),
    clearFiles: fieldName =>
        set(state => {
            const files = state.fileData[fieldName] || [];
            // Revoke all URLs for this field
            files.forEach(({ preview }) => URL.revokeObjectURL(preview));
            const newFileData = { ...state.fileData };
            const newErrors = { ...state.errors };
            delete newFileData[fieldName];
            delete newErrors[fieldName];
            return { fileData: newFileData, errors: newErrors };
        }),
    clearAll: () => {
        const state = get();
        // Revoke all URLs
        Object.values(state.fileData).forEach(files => {
            files.forEach(({ preview }) => URL.revokeObjectURL(preview));
        });
        return set({ fileData: {}, errors: {} });
    },
}));

// Helper function to get files outside of React components
export const getUploadFiles = (fieldName: string): File[] => {
    const fileData = useUploadStore.getState().fileData[fieldName] || EMPTY_ARRAY;
    return fileData.map(({ file }) => file);
};

// Selector to get file data for a specific field (returns stable empty array)
export const selectFileData = (fieldName: string) => (state: UploadState) => state.fileData[fieldName] || EMPTY_ARRAY;

// Selector to get error for a specific field
export const selectError = (fieldName: string) => (state: UploadState) => state.errors[fieldName] || null;
