import { sessionQueries } from "@/routes/_backend/dashboard/-queries/auth.queries";
import { lazy } from "react";

export const Account = {
  slug: "settings",
  title: "My Account",
  collections: [
    {
      title: "Profile",
      slug: "profile",
      icon: "UserRoundCog",
      label: "Profile",
      component: lazy(
        () =>
          import("@/routes/_backend/dashboard/-components/views/settings/profile"),
      ),
      loadData: async ({ queryClient }: { queryClient: any }) => {
        await queryClient.ensureQueryData(sessionQueries.list());
      },
    },
  ],
};
