import type { FormField } from "@/lib/validations/form";
import type { PromotionDetailDTO } from "@/lib/commerce/dto";

export const promotionFields = (promotion?: PromotionDetailDTO): FormField[] => [
  { type: "input", name: "code", label: "Code", placeholder: "SUMMER20", required: true, autoFocus: true, colSpan: 1, defaultValue: promotion?.code ?? "" },
  { type: "select", name: "status", label: "Status", required: true, colSpan: 1, defaultValue: promotion?.status ?? "draft", options: [{ label: "Draft", value: "draft" }, { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }] },
  { type: "select", name: "type", label: "Promotion type", required: true, colSpan: 1, defaultValue: promotion?.type ?? "standard", options: [{ label: "Standard", value: "standard" }, { label: "Buy X get Y", value: "buyget" }] },
  { type: "select", name: "methodType", label: "Method", required: true, colSpan: 1, defaultValue: promotion?.methodType ?? "percentage", options: [{ label: "Percentage", value: "percentage" }, { label: "Fixed amount", value: "fixed" }] },
  { type: "input", name: "value", label: "Value", inputType: "number", step: "any", required: true, colSpan: 1, defaultValue: String(promotion?.value ?? 0) },
  { type: "input", name: "currencyCode", label: "Currency", placeholder: "USD", optional: true, colSpan: 1, defaultValue: promotion?.currencyCode ?? "" },
  { type: "select", name: "targetType", label: "Target", required: true, colSpan: 1, defaultValue: promotion?.targetType ?? "order", options: [{ label: "Entire order", value: "order" }, { label: "Items", value: "items" }, { label: "Shipping methods", value: "shipping_methods" }] },
  { type: "select", name: "allocation", label: "Allocation", required: true, colSpan: 1, defaultValue: promotion?.allocation ?? "across", options: [{ label: "Across", value: "across" }, { label: "Each", value: "each" }, { label: "Once", value: "once" }] },
  { type: "input", name: "limit", label: "Usage limit", inputType: "number", optional: true, colSpan: 1, defaultValue: promotion?.limit ? String(promotion.limit) : "" },
  { type: "input", name: "maxQuantity", label: "Maximum quantity", inputType: "number", optional: true, colSpan: 1, defaultValue: promotion?.maxQuantity ? String(promotion.maxQuantity) : "" },
  { type: "switch", name: "isAutomatic", label: "Automatic promotion", description: "Apply without requiring a promotion code.", defaultValue: promotion?.isAutomatic ?? false, colSpan: 1 },
  { type: "switch", name: "isTaxInclusive", label: "Tax inclusive", description: "The discount value includes tax.", defaultValue: promotion?.isTaxInclusive ?? false, colSpan: 1 },
];

export const promotionFormData = (formData: FormData, promotion?: PromotionDetailDTO) => ({
  code: String(formData.get("code") ?? ""), type: String(formData.get("type") ?? "standard") as "standard" | "buyget", status: String(formData.get("status") ?? "draft") as "draft" | "active" | "inactive",
  isAutomatic: formData.get("isAutomatic") === "on", isTaxInclusive: formData.get("isTaxInclusive") === "on",
  limit: formData.get("limit") ? Number(formData.get("limit")) : undefined, methodType: String(formData.get("methodType") ?? "percentage") as "fixed" | "percentage",
  targetType: String(formData.get("targetType") ?? "order") as "order" | "items" | "shipping_methods", allocation: String(formData.get("allocation") ?? "across") as "each" | "across" | "once",
  value: Number(formData.get("value") ?? 0), currencyCode: String(formData.get("currencyCode") ?? "") || undefined, maxQuantity: formData.get("maxQuantity") ? Number(formData.get("maxQuantity")) : undefined,
  rules: promotion?.rules ?? [], targetRules: promotion?.targetRules ?? [], buyRules: promotion?.buyRules ?? [],
});
