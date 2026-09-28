import { shippingOptionTypeDal } from "@/lib/shipping/dal/shipping-option-type.dal";
import type { ShippingOptionTypeDTO } from "@/lib/shipping/dto/shipping-option-type.dto";
import type {
  createShippingOptionTypeInputSchema,
  deleteShippingOptionTypeInputSchema,
  updateShippingOptionTypeInputSchema,
} from "@/lib/validations/shipping-option-type";
import type { z } from "zod";

export type CreateShippingOptionTypeInput = z.infer<
  typeof createShippingOptionTypeInputSchema
>;
export type UpdateShippingOptionTypeInput = z.infer<
  typeof updateShippingOptionTypeInputSchema
>;
export type DeleteShippingOptionTypeInput = z.infer<
  typeof deleteShippingOptionTypeInputSchema
>;

export type ShippingOptionTypeWriteResult =
  | { success: true; message: string; data: { id: string } }
  | {
      success: false;
      message: string;
      error: string;
      errors?: Record<string, string[]>;
    };

type Dependencies = {
  dal: typeof shippingOptionTypeDal;
  createId(): string;
  now(): string;
};

const failure = (
  message: string,
  error: string,
  errors?: Record<string, string[]>,
): ShippingOptionTypeWriteResult => ({
  success: false,
  message,
  error,
  ...(errors ? { errors } : {}),
});

export const createShippingOptionTypeWriteService = (
  dependencies: Dependencies = {
    dal: shippingOptionTypeDal,
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  },
) => ({
  async create(
    input: CreateShippingOptionTypeInput,
  ): Promise<ShippingOptionTypeWriteResult> {
    try {
      if (await dependencies.dal.findByCode(input.code)) {
        return failure(
          "A shipping option type with this code already exists",
          "DUPLICATE_CODE",
          { code: ["This code is already in use"] },
        );
      }
      const id = dependencies.createId();
      await dependencies.dal.create({
        ...input,
        id,
        now: dependencies.now(),
      });
      return {
        success: true,
        message: "Shipping option type created successfully",
        data: { id },
      };
    } catch (error) {
      console.error("Create shipping option type error:", error);
      return failure("Failed to create shipping option type", "CREATE_FAILED");
    }
  },

  async update(
    input: UpdateShippingOptionTypeInput,
  ): Promise<ShippingOptionTypeWriteResult> {
    try {
      const current = await dependencies.dal.findById(input.id);
      if (!current) {
        return failure("Shipping option type not found", "NOT_FOUND");
      }
      if (current.updatedAt !== input.expectedUpdatedAt) {
        return failure(
          "This shipping option type changed while you were editing it. Reload and try again.",
          "CONFLICT",
        );
      }
      if (input.code && input.code !== current.code) {
        const duplicate = await dependencies.dal.findByCode(input.code);
        if (duplicate && duplicate.id !== current.id) {
          return failure(
            "A shipping option type with this code already exists",
            "DUPLICATE_CODE",
            { code: ["This code is already in use"] },
          );
        }
      }
      const updated = await dependencies.dal.update({
        id: input.id,
        expectedUpdatedAt: input.expectedUpdatedAt,
        label: input.label,
        code: input.code,
        description: input.description,
        now: dependencies.now(),
      });
      return updated
        ? {
            success: true,
            message: "Shipping option type updated successfully",
            data: { id: input.id },
          }
        : failure(
            "This shipping option type changed while you were editing it. Reload and try again.",
            "CONFLICT",
          );
    } catch (error) {
      console.error("Update shipping option type error:", error);
      return failure("Failed to update shipping option type", "UPDATE_FAILED");
    }
  },

  async delete(
    input: DeleteShippingOptionTypeInput,
  ): Promise<ShippingOptionTypeWriteResult> {
    try {
      const current = await dependencies.dal.findById(input.id);
      if (!current) {
        return failure("Shipping option type not found", "NOT_FOUND");
      }
      if (current.updatedAt !== input.expectedUpdatedAt) {
        return failure(
          "This shipping option type changed while you were editing it. Reload and try again.",
          "CONFLICT",
        );
      }
      const result = await dependencies.dal.softDelete({
        id: input.id,
        expectedUpdatedAt: input.expectedUpdatedAt,
        now: dependencies.now(),
      });
      if (result === "deleted") {
        return {
          success: true,
          message: "Shipping option type deactivated",
          data: { id: input.id },
        };
      }
      if (result === "conflict") {
        return failure(
          "This shipping option type changed while you were editing it. Reload and try again.",
          "CONFLICT",
        );
      }
      return failure("Shipping option type not found", "NOT_FOUND");
    } catch (error) {
      console.error("Delete shipping option type error:", error);
      return failure(
        "Failed to deactivate shipping option type",
        "DELETE_FAILED",
      );
    }
  },
});

export const shippingOptionTypeWriteService =
  createShippingOptionTypeWriteService();

export type ShippingOptionTypeWriteDTO = ShippingOptionTypeDTO;
