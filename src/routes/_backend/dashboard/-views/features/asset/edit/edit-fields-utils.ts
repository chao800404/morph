import type { FormField } from "@/lib/validations/form";
import type { EditItem } from "./use-asset-edit-store";

/**
 * Generate edit fields based on item type
 * @param item - The item to generate fields for (folder or asset)
 * @returns Array of form fields
 */
export const generateEditFields = (item: EditItem): FormField[] => {
  if (item.type === "folder") {
    return [
      {
        name: "Name",
        type: "input",
        value: item.name || "",
      },
      {
        name: "Description",
        type: "textarea",
        value: item.description || "",
      },
    ];
  }

  // Asset fields
  return [
    {
      name: "Name",
      type: "input",
      value: item.name || "",
    },
    {
      name: "Alt",
      type: "input",
      value: item.alt || "",
    },
    {
      name: "Caption",
      type: "input",
      value: item.caption || "",
    },
    {
      name: "Tags",
      type: "input",
      value: item.tags || "",
    },
  ];
};

/**
 * Generate edit title based on item type and count
 * @param type - Item type (folder or asset)
 * @param count - Number of items
 * @returns Title string
 */
export const generateEditTitle = (
  type: "folder" | "asset",
  count: number,
): string => {
  if (type === "folder") {
    return count > 1 ? "Edit Folders" : "Edit Folder";
  }
  return count > 1 ? "Edit Assets" : "Edit Asset";
};
