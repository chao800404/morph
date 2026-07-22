import { lazy } from "react";

export const General = {
  slug: "settings",
  title: "General",
  collections: [
    {
      title: "Store",
      slug: "store",
      icon: "Store",
      label: "Store",
      component: lazy(() => import("@views/settings/store")),
    },
    {
      title: "Users",
      slug: "users",
      icon: "UsersRound",
      label: "Users",
      component: lazy(() => import("@views/settings/users")),
    },
  ],
};
