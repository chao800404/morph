import { customerAddressDal } from "@/lib/customer/dal/customer-address.dal";
import type { CustomerAddressInput } from "@/lib/customer/dal/customer-address.dal";
import type {
  createCustomerAddressInputSchema,
  updateCustomerAddressInputSchema,
} from "@/lib/validations/customer";
import type { z } from "zod";

type CreateAddressInput = z.infer<typeof createCustomerAddressInputSchema>;
type UpdateAddressInput = z.infer<typeof updateCustomerAddressInputSchema>;

export class CustomerAddressWriteError extends Error {
  constructor(
    readonly code: "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "CustomerAddressWriteError";
  }
}

const normalizedFields = (
  input:
    | Omit<CreateAddressInput, "customerId">
    | Omit<UpdateAddressInput, "id" | "customerId">,
): Partial<CustomerAddressInput> => {
  const output: Record<string, unknown> = {};
  const textFields = [
    "addressName",
    "company",
    "firstName",
    "lastName",
    "address1",
    "address2",
    "city",
    "countryCode",
    "province",
    "postalCode",
    "phone",
  ] as const;
  for (const field of textFields) {
    const value = input[field];
    if (value !== undefined) {
      const normalized = value.trim();
      output[field] = normalized
        ? field === "countryCode"
          ? normalized.toLowerCase()
          : normalized
        : null;
    }
  }
  if (input.isDefaultShipping !== undefined)
    output.isDefaultShipping = input.isDefaultShipping;
  if (input.isDefaultBilling !== undefined)
    output.isDefaultBilling = input.isDefaultBilling;
  if (input.metadata !== undefined) output.metadata = input.metadata;
  return output as Partial<CustomerAddressInput>;
};

/** Shared by dashboard server functions and the Admin REST API. */
export const customerAddressWriteService = {
  async create(input: CreateAddressInput, now = new Date().toISOString()) {
    const id = crypto.randomUUID();
    const created = await customerAddressDal.create({
      id,
      customerId: input.customerId,
      fields: normalizedFields(input) as CustomerAddressInput,
      now,
    });
    if (!created)
      throw new CustomerAddressWriteError("NOT_FOUND", "Customer not found");
    return { id };
  },

  async update(input: UpdateAddressInput, now = new Date().toISOString()) {
    const { id, customerId, ...fields } = input;
    const updated = await customerAddressDal.update({
      id,
      customerId,
      fields: normalizedFields(fields),
      now,
    });
    if (!updated)
      throw new CustomerAddressWriteError(
        "NOT_FOUND",
        "Customer address not found",
      );
    return { id };
  },

  async archive(
    input: { id: string; customerId: string },
    now = new Date().toISOString(),
  ) {
    const deleted = await customerAddressDal.softDelete({ ...input, now });
    if (!deleted)
      throw new CustomerAddressWriteError(
        "NOT_FOUND",
        "Customer address not found",
      );
    return { id: input.id };
  },
};
