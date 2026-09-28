import { customerDal } from "@/lib/customer/dal/customer.dal";
import type {
  createCustomerInputSchema,
  updateCustomerInputSchema,
} from "@/lib/validations/customer";
import type { z } from "zod";

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export class CustomerWriteError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "DUPLICATE_EMAIL" | "ACCOUNT_EMAIL_LOCKED",
    message: string,
  ) {
    super(message);
    this.name = "CustomerWriteError";
  }
}

/** Shared by dashboard server functions and the Admin REST API. */
export const customerWriteService = {
  async create(
    data: CreateCustomerInput,
    actorId: string,
    now = new Date().toISOString(),
  ) {
    const email = data.email?.trim().toLowerCase() || null;
    if (email && (await customerDal.findActiveByEmail(email))) {
      throw new CustomerWriteError(
        "DUPLICATE_EMAIL",
        "A customer with this email already exists",
      );
    }
    const id = crypto.randomUUID();
    await customerDal.create({
      id,
      email,
      firstName: data.firstName?.trim() || null,
      lastName: data.lastName?.trim() || null,
      companyName: data.companyName?.trim() || null,
      phone: data.phone?.trim() || null,
      metadata: data.metadata,
      createdBy: actorId,
      now,
    });
    return { id };
  },

  async update(data: UpdateCustomerInput, now = new Date().toISOString()) {
    const existing = await customerDal.findById(data.id);
    if (!existing) {
      throw new CustomerWriteError("NOT_FOUND", "Customer not found");
    }
    const email = data.email?.trim().toLowerCase() || null;
    if (
      existing.hasAccount &&
      data.email !== undefined &&
      email !== existing.email
    ) {
      throw new CustomerWriteError(
        "ACCOUNT_EMAIL_LOCKED",
        "An account customer's email cannot be changed from this form",
      );
    }
    if (
      email &&
      email !== existing.email &&
      (await customerDal.findActiveByEmail(email, existing.hasAccount, data.id))
    ) {
      throw new CustomerWriteError(
        "DUPLICATE_EMAIL",
        "A customer with this email already exists",
      );
    }

    const changes: Parameters<typeof customerDal.update>[1] = {};
    if (data.email !== undefined) changes.email = email;
    if (data.firstName !== undefined)
      changes.firstName = data.firstName.trim() || null;
    if (data.lastName !== undefined)
      changes.lastName = data.lastName.trim() || null;
    if (data.companyName !== undefined)
      changes.companyName = data.companyName.trim() || null;
    if (data.phone !== undefined) changes.phone = data.phone.trim() || null;
    if (data.metadata !== undefined) changes.metadata = data.metadata;

    const updated = await customerDal.update(data.id, changes, now);
    if (!updated)
      throw new CustomerWriteError("NOT_FOUND", "Customer not found");
    return { id: data.id };
  },

  async archive(ids: string[], now = new Date().toISOString()) {
    const deleted = await customerDal.softDelete(ids, now);
    if (deleted === 0) {
      throw new CustomerWriteError(
        "NOT_FOUND",
        "No matching customers were found",
      );
    }
    return { deleted };
  },
};
