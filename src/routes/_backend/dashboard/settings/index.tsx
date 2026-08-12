import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_backend/dashboard/settings/")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/$slug",
      params: { slug: "store" },
      replace: true,
    });
  },
});
