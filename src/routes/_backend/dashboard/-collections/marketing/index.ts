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
      index: {
        view: lazy(() => import("@views/global/marketing/orders")),
      },
      create: {
        view: lazy(() =>
          import("@views/global/marketing/orders/order-create").then((m) => ({
            default: m.OrderCreate,
          })),
        ),
      },
    },
    {
      title: "Promotions",
      slug: "promotions",
      icon: "TicketPercent",
      label: "Promotions",
      index: {
        view: lazy(() => import("@views/global/marketing/promotions")),
      },
      create: {
        view: lazy(() =>
          import("@views/global/marketing/promotion-create").then((m) => ({
            default: m.PromotionCreate,
          })),
        ),
      },
    },
  ],
};
