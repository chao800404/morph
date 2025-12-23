import type { FormField } from "@/lib/validations/form";

/**
 * Generate move fields (always the same - folder select)
 * @returns Array of form fields for move dialog
 */
export const generateMoveFields = (): FormField[] => {
    return [
        {
            type: "folder-select",
            name: "Destination Folder",
            value: "",
            placeholder: "Select a folder or leave empty for root",
        },
    ];
};

/**
 * Generate move title based on item type and count
 * @param type - Item type (folder, asset, or undefined for mixed)
 * @param count - Number of items
 * @returns Title string
 */
export const generateMoveTitle = (type?: "folder" | "asset", count: number = 1): string => {
    if (!type || count > 1) {
        // For mixed types or multiple items, use generic title
        if (count > 1) {
            if (type === "folder") return "Move Folders";
            if (type === "asset") return "Move Assets";
            return "Move";
        }
    }
    return type === "folder" ? "Move Folder" : "Move Asset";
};

/**
 * Generate move description based on item type and count
 * @param type - Item type (folder, asset, or undefined for mixed)
 * @param count - Number of items
 * @returns Description string
 */
export const generateMoveDescription = (type?: "folder" | "asset", count: number = 1): string => {
    if (!type) {
        // For mixed types
        return count > 1 ? "Move selected items to another folder" : "Move item to another location";
    }

    const itemText = count > 1 ? `${count} ${type}s` : type;
    return `Move ${itemText} to another location`;
};
