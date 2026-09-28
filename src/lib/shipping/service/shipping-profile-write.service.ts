import { DEFAULT_SHIPPING_PROFILE_ID } from "@/lib/shipping/constants";
import { shippingProfileDal } from "@/lib/shipping/dal/shipping-profile.dal";
import type { ShippingProfileDTO } from "@/lib/shipping/dto/shipping-profile.dto";
import type {
  createShippingProfileInputSchema,
  updateShippingProfileInputSchema,
} from "@/lib/validations/shipping-profile";
import type { z } from "zod";

export type CreateShippingProfileInput = z.infer<
  typeof createShippingProfileInputSchema
>;
export type UpdateShippingProfileInput = z.infer<
  typeof updateShippingProfileInputSchema
>;

export type ShippingProfileWriteResult =
  | { success: true; message: string; data: { id: string } }
  | {
      success: false;
      message: string;
      error: string;
      errors?: Record<string, string[]>;
    };

type Dependencies = {
  dal: typeof shippingProfileDal;
  createId(): string;
  now(): string;
};

const failure = (
  message: string,
  error: string,
  errors?: Record<string, string[]>,
): ShippingProfileWriteResult => ({
  success: false,
  message,
  error,
  ...(errors ? { errors } : {}),
});

export const createShippingProfileWriteService = (
  dependencies: Dependencies = {
    dal: shippingProfileDal,
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  },
) => ({
  async create(
    input: CreateShippingProfileInput,
  ): Promise<ShippingProfileWriteResult> {
    try {
      if (await dependencies.dal.findByName(input.name)) {
        return failure(
          "A shipping profile with this name already exists",
          "DUPLICATE_NAME",
          { name: ["This name is already in use"] },
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
        message: "Shipping profile created successfully",
        data: { id },
      };
    } catch (error) {
      console.error("Create shipping profile error:", error);
      return failure("Failed to create shipping profile", "CREATE_FAILED");
    }
  },

  async update(
    input: UpdateShippingProfileInput,
  ): Promise<ShippingProfileWriteResult> {
    try {
      const current = await dependencies.dal.findById(input.id);
      if (!current) return failure("Shipping profile not found", "NOT_FOUND");
      if (
        input.type === "default" &&
        input.id !== DEFAULT_SHIPPING_PROFILE_ID
      ) {
        return failure(
          "Only the system profile can use the default type",
          "INVALID_DEFAULT_TYPE",
          { type: ["Choose Custom or Gift card"] },
        );
      }
      if (input.name && input.name !== current.name) {
        const duplicate = await dependencies.dal.findByName(input.name);
        if (duplicate && duplicate.id !== current.id) {
          return failure(
            "A shipping profile with this name already exists",
            "DUPLICATE_NAME",
            { name: ["This name is already in use"] },
          );
        }
      }
      const updated = await dependencies.dal.update({
        id: input.id,
        name: input.name,
        ...(input.type && input.type !== "default" ? { type: input.type } : {}),
        now: dependencies.now(),
      });
      return updated
        ? {
            success: true,
            message: "Shipping profile updated successfully",
            data: { id: input.id },
          }
        : failure("Shipping profile not found", "NOT_FOUND");
    } catch (error) {
      console.error("Update shipping profile error:", error);
      return failure("Failed to update shipping profile", "UPDATE_FAILED");
    }
  },

  async delete(id: string): Promise<ShippingProfileWriteResult> {
    try {
      const result = await dependencies.dal.softDelete(id, dependencies.now());
      if (result === "deleted") {
        return {
          success: true,
          message: "Shipping profile deleted",
          data: { id },
        };
      }
      if (result === "default") {
        return failure(
          "The default shipping profile cannot be deleted",
          "DEFAULT_PROFILE",
        );
      }
      if (result === "in-use") {
        return failure(
          "Reassign its products and remove its shipping options before deleting this profile",
          "PROFILE_IN_USE",
        );
      }
      return failure("Shipping profile not found", "NOT_FOUND");
    } catch (error) {
      console.error("Delete shipping profile error:", error);
      return failure("Failed to delete shipping profile", "DELETE_FAILED");
    }
  },
});

export const shippingProfileWriteService = createShippingProfileWriteService();

export type ShippingProfileWriteDTO = ShippingProfileDTO;
