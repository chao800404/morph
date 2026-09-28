import type { FormField } from "@/lib/validations/form";
import type { InventoryListItemDTO } from "@/lib/inventory/dto/inventory.dto";
import type { ReservationDTO } from "@/lib/inventory/dto/reservation.dto";

export const reservationFormFields = (input: {
  items: InventoryListItemDTO[];
  item?: InventoryListItemDTO | null;
  reservation?: ReservationDTO | null;
  fixedInventoryItemId?: string;
  selectedItemId?: string;
  selectedLocationId?: string;
}): FormField[] => {
  const fixedItem = Boolean(input.fixedInventoryItemId);
  const selectedLocationId =
    input.selectedLocationId ?? input.reservation?.locationId;
  const fields: FormField[] = [];
  if (fixedItem && input.fixedInventoryItemId) {
    fields.push({
      type: "hidden",
      name: "inventoryItemId",
      value: input.fixedInventoryItemId,
    });
  } else {
    fields.push({
      type: "select",
      name: "inventoryItemId",
      label: "Inventory item",
      value: input.selectedItemId ?? input.item?.id ?? "__select_item__",
      required: true,
      options: [
        { value: "__select_item__", label: "Select an inventory item" },
        ...input.items.map((item) => ({
          value: item.id,
          label: `${item.title ?? "Untitled"}${item.sku ? ` · ${item.sku}` : ""}${item.unitOfMeasure ? ` · ${item.unitOfMeasure}` : ""}`,
        })),
      ],
    });
  }
  const locations = (input.item?.locationLevels ?? []).filter(
    (level) => level.locationName !== null,
  );
  fields.push({
    type: "select",
    name: "locationId",
    label: "Stock location",
    value:
      input.reservation?.locationId ??
      input.selectedLocationId ??
      "__select_location__",
    required: true,
    disabled: Boolean(input.reservation),
    options: [
      { value: "__select_location__", label: "Select a location" },
      ...locations.map((level) => ({
        value: level.locationId,
        label: level.locationName ?? "Unavailable location",
      })),
    ],
  });
  fields.push(
    {
      type: "input",
      name: "quantity",
      label: "Quantity",
      inputType: "number",
      step: "any",
      value: String(input.reservation?.quantity ?? 1),
      required: true,
      description:
        input.item && selectedLocationId
          ? `Available at this location: ${input.item.locationLevels.find((level) => level.locationId === selectedLocationId)?.availableQuantity ?? 0}${input.item.unitOfMeasure ? ` ${input.item.unitOfMeasure}` : ""}`
          : "The reservation reduces available inventory at the selected location.",
    },
    {
      type: "switch",
      name: "allowBackorder",
      label: "Allow backorder",
      description:
        "Allow the reserved quantity to exceed the current stocked quantity.",
      value: input.reservation?.allowBackorder ?? false,
    },
    {
      type: "textarea",
      name: "description",
      label: "Description",
      value: input.reservation?.description ?? "",
      optional: true,
      rows: 3,
    },
    {
      type: "input",
      name: "externalId",
      label: "External ID",
      value: input.reservation?.externalId ?? "",
      optional: true,
    },
  );
  return fields;
};
