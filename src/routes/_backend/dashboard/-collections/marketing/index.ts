import { lazy } from "react";

export const Marketing = {
  slug: "/",
  title: "Marketing",
  collections: [
    {
      title: "Orders",
      slug: "orders",
      icon: "ShoppingCart",
      label: "Orders",
      component: lazy(() => import("@views/global/marketing/orders")),
    },
    {
      title: "Promotions",
      slug: "promotions",
      icon: "TicketPercent",
      label: "Promotions",
      component: lazy(() => import("@views/global/marketing/promotions")),
    },
  ],
};
