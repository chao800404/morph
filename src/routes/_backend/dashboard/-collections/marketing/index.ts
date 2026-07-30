import { lazyView } from "@/lib/config/lazy-view";

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
        view: lazyView(() => import("@views/global/marketing/orders")),
      },
      create: {
        view: lazyView(() =>
          import("@views/global/marketing/orders/order-create"),
        ),
      },
    },
    {
      title: "Promotions",
      slug: "promotions",
      icon: "TicketPercent",
      label: "Promotions",
      index: {
        view: lazyView(() => import("@views/global/marketing/promotions")),
      },
      create: {
        view: lazyView(() =>
          import("@views/global/marketing/promotion-create"),
        ),
      },
    },
  ],
};
