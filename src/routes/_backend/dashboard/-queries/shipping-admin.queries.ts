import { getLocationShippingOptions } from "@/server/shipping/shipping-admin.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const shippingAdminQueries = {
  all: () => ["location-shipping-options"] as const,
  forLocation: (locationId: string) =>
    queryOptions({
      queryKey: [...shippingAdminQueries.all(), locationId],
      queryFn: () => getLocationShippingOptions({ data: { locationId } }),
    }),
};
