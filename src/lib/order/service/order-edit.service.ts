import type { OrderEditRequest } from "@/lib/order/dal/order-edit-request.dal";
import {
  orderEditRequestDal,
  type OrderEditItemChangeInput,
} from "@/lib/order/dal/order-edit-request.dal";
import { calculateDraftOrderTotal } from "@/lib/order/draft-order";
import { orderDal } from "@/lib/order/dal/order.dal";
import { resolveDraftShippingOptions } from "@/lib/order/draft-order";
import { shippingAvailabilityDal } from "@/lib/shipping/dal/shipping-availability.dal";

type EditFailure =
  | { success: true; edit: OrderEditRequest }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "NOT_ORDER"
        | "EDIT_EXISTS"
        | "EDIT_NOT_FOUND"
        | "EDIT_NOT_REQUESTED"
        | "CONFLICT"
        | "INVALID_ACTION"
        | "ITEM_EDIT_UNSUPPORTED";
    };

const itemChangesFromEdit = (
  edit: OrderEditRequest,
): OrderEditItemChangeInput[] | null => {
  const changes: OrderEditItemChangeInput[] = [];
  for (const action of edit.actions) {
    if (action.action !== "ITEM_UPDATE" && action.action !== "ITEM_REMOVE")
      continue;
    if (action.reference !== "item" || !action.referenceId) return null;
    if (action.action === "ITEM_REMOVE") {
      changes.push({ itemId: action.referenceId, action: "ITEM_REMOVE" });
      continue;
    }
    if (
      !action.details ||
      typeof action.details !== "object" ||
      Array.isArray(action.details)
    )
      return null;
    const quantity = (action.details as Record<string, unknown>).quantity;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity))
      return null;
    changes.push({
      itemId: action.referenceId,
      action: "ITEM_UPDATE",
      quantity,
    });
  }
  return changes;
};

const shippingRemainsValid = async (
  orderId: string,
  changes: readonly OrderEditItemChangeInput[],
) => {
  if (!changes.length) return true;
  try {
    const context = await orderDal.findDraftShippingContext(orderId);
    if (
      !context ||
      context.order.isDraftOrder ||
      context.order.status !== "pending"
    )
      return false;
    const changesByItemId = new Map(
      changes.map((change) => [change.itemId, change]),
    );
    const items = context.items.flatMap((item) => {
      const change = changesByItemId.get(item.itemId);
      if (change?.action === "ITEM_REMOVE") return [];
      return [
        {
          productId: item.productId,
          requiresShipping: item.requiresShipping,
          quantity:
            change?.action === "ITEM_UPDATE" ? change.quantity : item.quantity,
          unitPrice: item.unitPrice,
        },
      ];
    });
    if (!items.length) return false;
    const itemSubtotal = calculateDraftOrderTotal(items);
    if (itemSubtotal === null) return false;

    const physicalItems = items.filter((item) => item.requiresShipping);
    if (!physicalItems.length)
      return context.selectedShippingMethods.length === 0;
    if (
      physicalItems.some((item) => !item.productId) ||
      !context.order.regionId ||
      !context.order.salesChannelId ||
      !context.shippingAddress?.countryCode
    )
      return false;
    if (
      context.hasCustomShippingMethod ||
      context.selectedShippingMethods.some(
        (method) => method.isCustomAmount || !method.shippingOptionId,
      )
    )
      return false;

    const quote = await shippingAvailabilityDal.quote({
      owner: { type: "order", id: orderId },
      regionId: context.order.regionId,
      salesChannelId: context.order.salesChannelId,
      currencyCode: context.order.currencyCode,
      shippingAddress: {
        countryCode: context.shippingAddress.countryCode,
        provinceCode: context.shippingAddress.province,
        city: context.shippingAddress.city,
        postalCode: context.shippingAddress.postalCode,
      },
      items: items.map((item) => ({
        productId: item.productId,
        requiresShipping: item.requiresShipping,
        quantity: item.quantity,
      })),
      itemSubtotal,
      itemDiscountTotal: 0,
    });
    const selected = resolveDraftShippingOptions({
      selectedOptionIds: context.selectedShippingOptionIds,
      availableOptions: quote.availableOptions,
      requiredShippingProfiles: quote.requiredShippingProfiles,
    });
    if (!selected || selected.length !== context.selectedShippingMethods.length)
      return false;
    const methodsByOptionId = new Map(
      context.selectedShippingMethods.flatMap((method) =>
        method.shippingOptionId
          ? [[method.shippingOptionId, method] as const]
          : [],
      ),
    );
    return (
      methodsByOptionId.size === selected.length &&
      selected.every(
        (option) => methodsByOptionId.get(option.id)?.amount === option.amount,
      )
    );
  } catch {
    return false;
  }
};

export const orderEditService = {
  async request(input: {
    orderId: string;
    actorId: string;
    email?: string;
    noNotification?: boolean;
    itemChanges?: OrderEditItemChangeInput[];
  }): Promise<EditFailure> {
    if (!(await shippingRemainsValid(input.orderId, input.itemChanges ?? [])))
      return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
    return orderEditRequestDal.request(input);
  },

  async confirm(input: {
    orderId: string;
    editId: string;
    actorId: string;
    ownership?: {
      customerId: string;
      email: string;
      salesChannelId: string | null;
    };
  }): Promise<EditFailure> {
    const edit = await orderEditRequestDal.get(input.orderId);
    if (edit && edit.id === input.editId) {
      const changes = itemChangesFromEdit(edit);
      if (!changes || !(await shippingRemainsValid(input.orderId, changes)))
        return { success: false, reason: "ITEM_EDIT_UNSUPPORTED" };
    }
    return orderEditRequestDal.confirm(input);
  },
};
