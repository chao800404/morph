import { createFileRoute } from "@tanstack/react-router";
import { productQueries } from "@queries/product.queries";
import { salesChannelQueries } from "@queries/sales-channel.queries";
import DashboardHome from "./-views/home/dashboard-home";
import {
  DASHBOARD_HOME_CHANNEL_PARAMS,
  DASHBOARD_HOME_PRODUCT_PARAMS,
} from "./-views/home/dashboard-home.config";
import { DashboardHomePending } from "./-views/home/dashboard-home-pending";

export const Route = createFileRoute("/_backend/dashboard/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        productQueries.list(DASHBOARD_HOME_PRODUCT_PARAMS),
      ),
      context.queryClient.ensureQueryData(
        salesChannelQueries.list(DASHBOARD_HOME_CHANNEL_PARAMS),
      ),
    ]);
  },
  pendingComponent: DashboardHomePending,
  pendingMs: 0,
  pendingMinMs: 250,
  component: DashboardHome,
});
