import type { AssetActionResult } from "@/lib/asset/action-result";
import { metadataInputSchema } from "@/lib/validations/product";
import { updateCustomerInputSchema } from "@/lib/validations/customer";
import {
  createCustomer,
  deleteCustomers,
  updateCustomer,
} from "@/server/customer/customers.serverFn";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  updateCustomerAddress,
} from "@/server/customer/customer-addresses.serverFn";

const text = (data: FormData, key: string): string | undefined => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : undefined;
};

const readMetadata = (data: FormData) => {
  const raw = data.get("metadata");
  if (typeof raw !== "string") return { success: true as const, data: {} };
  try {
    return metadataInputSchema.safeParse(JSON.parse(raw));
  } catch {
    return metadataInputSchema.safeParse(null);
  }
};

const toActionResult = (result: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: result.success,
  message: result.message,
  errors: result.errors
    ? Object.fromEntries(
        Object.entries(result.errors).filter(
          (entry): entry is [string, string[]] => entry[1] !== undefined,
        ),
      )
    : undefined,
});

export const createCustomerAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const metadata = readMetadata(data);
  if (!metadata.success) {
    return { success: false, message: "Customer metadata is invalid" };
  }
  return toActionResult(
    await createCustomer({
      data: {
        email: text(data, "email") || undefined,
        firstName: text(data, "firstName") || undefined,
        lastName: text(data, "lastName") || undefined,
        companyName: text(data, "companyName") || undefined,
        phone: text(data, "phone") || undefined,
        metadata: metadata.data,
      },
    }),
  );
};

export const updateCustomerAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) return { success: false, message: "Missing customer ID" };
  const metadata = readMetadata(data);
  if (!metadata.success) {
    return { success: false, message: "Customer metadata is invalid" };
  }
  const input: Partial<typeof updateCustomerInputSchema._output> & { id: string } = { id };
  for (const key of ["email", "firstName", "lastName", "companyName", "phone"] as const) {
    const value = text(data, key);
    if (value !== undefined) input[key] = value;
  }
  if (data.has("metadata")) input.metadata = metadata.data;
  return toActionResult(
    await updateCustomer({
      data: input,
    }),
  );
};

export const updateCustomerMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) return { success: false, message: "Missing customer ID" };
  const metadata = readMetadata(data);
  if (!metadata.success) {
    return { success: false, message: "Customer metadata is invalid" };
  }
  return toActionResult(
    await updateCustomer({ data: { id, metadata: metadata.data } }),
  );
};

export const deleteCustomerAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const raw = data.get("customerIds");
  let ids: string[] = [];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        ids = parsed.filter((id): id is string => typeof id === "string");
      }
    } catch {
      return { success: false, message: "Customer selection is invalid" };
    }
  }
  if (ids.length === 0) {
    return { success: false, message: "No customers selected" };
  }
  return toActionResult(await deleteCustomers({ data: { ids } }));
};

const checked = (data: FormData, key: string) => {
  const value = data.get(key);
  return value === "true" || value === "on";
};

const addressInput = (data: FormData) => ({
  addressName: text(data, "addressName") ?? "",
  isDefaultShipping: checked(data, "isDefaultShipping"),
  isDefaultBilling: checked(data, "isDefaultBilling"),
  company: text(data, "company") ?? "",
  firstName: text(data, "firstName") ?? "",
  lastName: text(data, "lastName") ?? "",
  address1: text(data, "address1") ?? "",
  address2: text(data, "address2") ?? "",
  city: text(data, "city") ?? "",
  countryCode: text(data, "countryCode") ?? "",
  province: text(data, "province") ?? "",
  postalCode: text(data, "postalCode") ?? "",
  phone: text(data, "phone") ?? "",
});

export const createCustomerAddressAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const customerId = text(data, "customerId");
  if (!customerId) return { success: false, message: "Missing customer ID" };
  return toActionResult(
    await createCustomerAddress({
      data: { customerId, ...addressInput(data) },
    }),
  );
};

export const updateCustomerAddressAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const customerId = text(data, "customerId");
  const id = text(data, "addressId");
  if (!customerId || !id) {
    return { success: false, message: "Customer address is incomplete" };
  }
  return toActionResult(
    await updateCustomerAddress({
      data: { customerId, id, ...addressInput(data) },
    }),
  );
};

export const deleteCustomerAddressAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const customerId = text(data, "customerId");
  const id = text(data, "addressId");
  if (!customerId || !id) {
    return { success: false, message: "Customer address is incomplete" };
  }
  return toActionResult(await deleteCustomerAddress({ data: { customerId, id } }));
};
