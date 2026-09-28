import {
  createLocationShippingRateInputSchema,
  deleteLocationShippingRateInputSchema,
  getLocationShippingOptionsInputSchema,
  updateLocationShippingRateInputSchema,
} from "@/lib/validations/shipping-admin";
import { parseInput } from "@/lib/db/server-result";
import { locationShippingOptionsService } from "@/lib/shipping/service/location-shipping-options.service";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const getLocationShippingOptions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(getLocationShippingOptionsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return locationShippingOptionsService.list(input.data.locationId);
  });

export const createLocationShippingRate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createLocationShippingRateInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return locationShippingOptionsService.create(input.data);
  });

export const updateLocationShippingRate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateLocationShippingRateInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return locationShippingOptionsService.update(input.data);
  });

export const deleteLocationShippingRate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(deleteLocationShippingRateInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return locationShippingOptionsService.delete(input.data);
  });
