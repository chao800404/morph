import type {
  CollectionGroup,
  CollectionItem,
  CollectionLoadContext,
} from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";
import {
  CollectionDetailSkeleton,
  createCollectionIndexPendingView,
} from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import { createRouteSurfacePendingView } from "@/components/dialog/route-surface-pending";

const CustomerCreatePendingView = createRouteSurfacePendingView(5);
const CustomerEditPendingView = createRouteSurfacePendingView(5);
const CustomerMetadataPendingView = createRouteSurfacePendingView(2);
const CustomerAddressPendingView = createRouteSurfacePendingView(7);
const CustomerGroupCreatePendingView = createRouteSurfacePendingView(3);
const CustomerGroupEditPendingView = createRouteSurfacePendingView(3);
const CustomerGroupMetadataPendingView = createRouteSurfacePendingView(2);
const CustomerGroupMembersPendingView = createCollectionIndexPendingView(4);

const customerGroupItem: NonNullable<CollectionItem["items"]>[number] = {
  title: "Customer Groups",
  slug: "customer-groups",
  label: "Customer Groups",
  index: {
    view: lazyView(() => import("@views/global/marketing/customer-groups")),
    pendingView: createCollectionIndexPendingView(4),
    prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
      const { customerGroupQueries, normalizeCustomerGroupListParams } =
        await import("@queries/customer.queries");
      void queryClient.prefetchQuery(
        customerGroupQueries.list(normalizeCustomerGroupListParams(search)),
      );
    },
  },
  create: {
    view: lazyView(
      () => import("@views/global/marketing/customer-group-create"),
    ),
    pendingView: CustomerGroupCreatePendingView,
  },
  detail: {
    view: lazyView(
      () => import("@views/global/marketing/customer-group-detail"),
    ),
    pendingView: CollectionDetailSkeleton,
    breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
      if (!params.id) return null;
      const { customerGroupQueries } = await import("@queries/customer.queries");
      const result = await queryClient.ensureQueryData(
        customerGroupQueries.detail(params.id),
      );
      return result.success ? result.data.name : null;
    },
    prefetch: async ({
      queryClient,
      params,
      search,
    }: CollectionLoadContext) => {
      if (!params.id) return;
      const {
        customerGroupQueries,
        normalizeCustomerGroupMemberListParams,
      } = await import("@queries/customer.queries");
      void queryClient.prefetchQuery(customerGroupQueries.detail(params.id));
      void queryClient.prefetchQuery(
        customerGroupQueries.members(
          normalizeCustomerGroupMemberListParams(params.id, search),
        ),
      );
    },
  },
  edit: {
    view: lazyView(
      () => import("@views/global/marketing/customer-group-edit"),
    ),
    pendingView: CustomerGroupEditPendingView,
    prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
      if (!params.id) return;
      const { customerGroupQueries } = await import("@queries/customer.queries");
      void queryClient.prefetchQuery(customerGroupQueries.detail(params.id));
    },
  },
  pages: {
    metadata: {
      view: lazyView(
        () => import("@views/global/marketing/customer-group-metadata"),
      ),
      pendingView: CustomerGroupMetadataPendingView,
      prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
        if (!params.id) return;
        const { customerGroupQueries } = await import("@queries/customer.queries");
        void queryClient.prefetchQuery(customerGroupQueries.detail(params.id));
      },
    },
    "add-customers": {
      view: lazyView(
        () => import("@views/global/marketing/customer-group-add-customers"),
      ),
      presentation: "replace",
      pendingView: CustomerGroupMembersPendingView,
      prefetch: async ({ queryClient, params, search }: CollectionLoadContext) => {
        if (!params.id) return;
        const { customerGroupQueries, customerQueries, normalizeCustomerListParams } =
          await import("@queries/customer.queries");
        void queryClient.prefetchQuery(customerGroupQueries.detail(params.id));
        void queryClient.prefetchQuery(
          customerQueries.list({
            ...normalizeCustomerListParams(search),
            limit: Number(search.limit) || 50,
          }),
        );
      },
    },
  },
};

const customerItem: CollectionItem = {
  title: "Customers",
  slug: "customers",
  icon: "Users",
  label: "Customers",
  index: {
    view: lazyView(() => import("@views/global/marketing/customers")),
    pendingView: createCollectionIndexPendingView(4),
    prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
      const { customerQueries, normalizeCustomerListParams } =
        await import("@queries/customer.queries");
      void queryClient.prefetchQuery(
        customerQueries.list(normalizeCustomerListParams(search)),
      );
    },
  },
  create: {
    view: lazyView(() => import("@views/global/marketing/customer-create")),
    pendingView: CustomerCreatePendingView,
  },
  detail: {
    view: lazyView(() => import("@views/global/marketing/customer-detail")),
    pendingView: CollectionDetailSkeleton,
    breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
      if (!params.id) return null;
      const { customerQueries } = await import("@queries/customer.queries");
      const result = await queryClient.ensureQueryData(
        customerQueries.detail(params.id),
      );
      return result.success
        ? result.data.email ||
            [result.data.firstName, result.data.lastName]
              .filter(Boolean)
              .join(" ") ||
            null
        : null;
    },
    prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
      if (!params.id) return;
      const { customerQueries } = await import("@queries/customer.queries");
      void queryClient.prefetchQuery(customerQueries.detail(params.id));
    },
  },
  edit: {
    view: lazyView(() => import("@views/global/marketing/customer-edit")),
    pendingView: CustomerEditPendingView,
    prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
      if (!params.id) return;
      const { customerQueries } = await import("@queries/customer.queries");
      void queryClient.prefetchQuery(customerQueries.detail(params.id));
    },
  },
  pages: {
    metadata: {
      view: lazyView(
        () => import("@views/global/marketing/customer-metadata"),
      ),
      pendingView: CustomerMetadataPendingView,
      prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
        if (!params.id) return;
        const { customerQueries } = await import("@queries/customer.queries");
        void queryClient.prefetchQuery(customerQueries.detail(params.id));
      },
    },
    "create-address": {
      view: lazyView(
        () => import("@views/global/marketing/customer-address-create"),
      ),
      pendingView: CustomerAddressPendingView,
      prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
        if (!params.id) return;
        const { customerQueries } = await import("@queries/customer.queries");
        void queryClient.prefetchQuery(customerQueries.detail(params.id));
      },
    },
    "edit-address": {
      view: lazyView(
        () => import("@views/global/marketing/customer-address-edit"),
      ),
      pendingView: CustomerAddressPendingView,
      prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
        if (!params.id) return;
        const { customerQueries } = await import("@queries/customer.queries");
        void queryClient.prefetchQuery(customerQueries.detail(params.id));
      },
    },
  },
  items: [customerGroupItem],
};

export const CustomerManagement: CollectionGroup = {
  slug: "/",
  title: "Customers",
  collections: [customerItem],
};
