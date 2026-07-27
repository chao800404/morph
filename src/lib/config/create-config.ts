/**
 * CMS Configuration Factory
 *
 * This module provides a factory function to create type-safe CMS configuration.
 * It handles:
 * - Configuration validation
 * - Type safety
 * - Separation of server-only and client-safe parts
 */

import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import type { EmailAdapter } from "../email/types";
import type { DashboardSearch } from "../validations/dashboard-search";
import { localization } from "../config/localization";
import { assertCollectionsAreAddressable } from "./navigation";

/**
 * Which Cloudflare plan this deployment runs on.
 *
 * Bulk operations are capped by Workers' per-request subrequest budget, which
 * differs by an order of magnitude between plans (50 vs 1,000). Stating the
 * plan is something an operator knows; the derived limits are not.
 */
export type CloudflarePlan = "free" | "paid";

export interface CloudflareDeployment {
  /** Defaults to "paid". */
  plan?: CloudflarePlan;
}

/**
 * Context handed to a collection's `prefetch` by the dynamic dashboard routes.
 * `search` has already passed `dashboardSearchSchema` in the route.
 */
export interface CollectionLoadContext {
  queryClient: QueryClient;
  params: Record<string, string>;
  search: DashboardSearch;
}

/**
 * A collection's index route, rendered at `/dashboard/<slug>`.
 *
 * `index` describes the collection's default destination. The UI can be a
 * table, grid, explorer, or any other view; its name deliberately describes
 * the route's role rather than its visual implementation.
 */
export interface CollectionIndex {
  view: ComponentType;
  /**
   * Suspense fallback rendered while `view`'s chunk loads.
   *
   * Defaults to a centred spinner. Give an index route its own skeleton when
   * its in-view loading state uses the same skeleton, so code and data loading
   * appear as one continuous state.
   */
  pendingView?: ComponentType;
  /** Start priming the index route's query cache before rendering it. */
  prefetch?: (context: CollectionLoadContext) => Promise<void> | void;
}

/**
 * A collection's create page.
 *
 * Creating is always a route, rendered at `/dashboard/<slug>/create` as a child
 * of the list. The list stays mounted underneath, so closing is a navigation
 * back to it rather than a remount and refetch, and every create surface is
 * linkable and survives a refresh.
 *
 * Whether the form looks like a full-screen page or a side panel is the
 * component's own choice of `RouteFormModal` size — not a second mechanism.
 * There is deliberately no "open a dialog from page state" mode: that would
 * mean the config had to carry fields, actions and cache keys just to feed a
 * generic renderer, while a page component simply does those things itself.
 *
 * The framework owns the URL — a collection supplies a view, not a path —
 * so a create page cannot be pointed at the wrong route or shadow another
 * collection's slug.
 *
 * Omit `create` entirely and no button is rendered.
 */
export interface CollectionCreate {
  view: ComponentType;
  /** Suspense fallback while `view` loads. */
  pendingView?: ComponentType;
  label?: string;
}

/**
 * A collection's detail page, rendered at `/dashboard/<slug>/<id>`.
 *
 * Like `create`, the framework owns the URL. This is why collection URLs are
 * flat: a nested collection at `/dashboard/products/options` would make
 * `/dashboard/products/<id>` ambiguous.
 */
export interface CollectionDetail {
  view: ComponentType;
  /** Suspense fallback while `view` loads. */
  pendingView?: ComponentType;
  /** Start priming the detail route's query cache before rendering it. */
  prefetch?: (context: CollectionLoadContext) => Promise<void> | void;
}

/**
 * A collection-level preview page, rendered at `/dashboard/<slug>/view`.
 *
 * This route is for browsing a collection-specific media or document view. It
 * replaces the index while mounted; the currently viewed record belongs in
 * validated search state because `view` is a collection action, not a record
 * id.
 */
export interface CollectionPreview {
  view: ComponentType;
  /** Suspense fallback while `view` loads. */
  pendingView?: ComponentType;
  /** Start priming the preview route's query cache before rendering it. */
  prefetch?: (context: CollectionLoadContext) => Promise<void> | void;
}

/**
 * A collection's edit page, rendered at `/dashboard/<slug>/<id>/edit`.
 *
 * Same contract as `create`: a route, not a dialog opened from row state. That
 * is what makes an edit surface linkable and survive a refresh — it loads its
 * record from the id in the URL rather than from whatever the list happened to
 * have in memory.
 *
 * `detail` is optional. Without one, closing returns to the list instead of to
 * a detail page that does not exist.
 */
export interface CollectionEdit {
  view: ComponentType;
  /** Suspense fallback while `view` loads. */
  pendingView?: ComponentType;
  /** Start priming the edit route's query cache before rendering it. */
  prefetch?: (context: CollectionLoadContext) => Promise<void> | void;
  /** Row action label. Defaults to "Edit". */
  label?: string;
}

/**
 * Configuration types
 */
export interface CollectionItem {
  title: string;
  slug: string;
  icon?: string;
  label?: string;
  index?: CollectionIndex;
  create?: CollectionCreate;
  preview?: CollectionPreview;
  detail?: CollectionDetail;
  edit?: CollectionEdit;
  items?: {
    title: string;
    slug: string;
    label?: string;
    index?: CollectionIndex;
    create?: CollectionCreate;
    preview?: CollectionPreview;
    detail?: CollectionDetail;
    edit?: CollectionEdit;
  }[];
}

export interface CollectionGroup {
  slug: string;
  title: string;
  collections: CollectionItem[];
}

export interface CMSConfigInput {
  appName: string;
  database?: {
    connectionString: string | undefined;
  };
  collections: {
    global: CollectionGroup[];
    settings: CollectionGroup[];
  };
  upload: {
    maxFileSize: number;
    minFiles: number;
    maxFiles: number;
    allowedTypes: string[];
    allowedExtensions: string[];
  };
  localization: typeof localization;
  auth: {
    autoLogout: {
      enabled: boolean;
      timeout: number;
      promptBeforeIdle: number;
    };
  };
  features?: {
    removeBackground?: {
      enabled?: boolean;
    };
  };
  email?: EmailAdapter;
  cloudflare?: CloudflareDeployment;
  trustedOrigins: string[];
}

/**
 * The shape a user authors in `src/cms.config.ts`.
 *
 * Everything here is declarative and safe in both builds. Secrets go in
 * `server`, which is wrapped in `createServerOnlyFn` so the compiler removes
 * its body from the client bundle.
 */
export interface CMSUserConfig {
  appName: string;
  collections: {
    global: CollectionGroup[];
    settings: CollectionGroup[];
  };
  upload: CMSConfigInput["upload"];
  localization: typeof localization;
  auth: CMSConfigInput["auth"];
  features?: CMSConfigInput["features"];
  cloudflare?: CloudflareDeployment;
  trustedOrigins: string[];
  email: {
    defaultFromAddress: string;
    defaultFromName?: string;
  };
  /** Server-only values. Wrap with `createServerOnlyFn`. */
  server: () => {
    database?: {
      connectionString: string | undefined;
    };
    email?: {
      apiKey: string;
    };
  };
}

/**
 * Identity helper that gives `src/cms.config.ts` full autocomplete and
 * type-checking while preserving the literal types of what was authored.
 */
export const defineConfig = <T extends CMSUserConfig>(config: T): T => config;

/**
 * Client-safe configuration (subset of full config)
 */
export interface ClientSafeConfig {
  appName: string;
  localization: typeof localization;
  collections: {
    global: CollectionGroup[];
    settings: CollectionGroup[];
  };
  upload: {
    maxFileSize: number;
    minFiles: number;
    maxFiles: number;
    allowedTypes: string[];
    allowedExtensions: string[];
  };
  auth?: {
    autoLogout?: {
      enabled: boolean;
      timeout: number;
      promptBeforeIdle: number;
    };
  };
  features: {
    removeBackground: {
      enabled: boolean;
    };
  };
}

export const isRemoveBackgroundEnabled = (
  config: Pick<CMSConfigInput, "features">,
) => config.features?.removeBackground?.enabled === true;

/**
 * Create CMS Configuration
 *
 * This factory function:
 * 1. Validates the configuration
 * 2. Provides type safety
 * 3. Separates server-only and client-safe parts
 *
 * @param config - The CMS configuration input
 * @returns Configuration object with server and client parts
 */
export function createCMSConfig<T extends CMSConfigInput>(config: T) {
  // Validate configuration (optional, can add more validation)
  if (!config.appName) {
    throw new Error("CMS Config: appName is required");
  }

  if (!config.localization) {
    throw new Error("CMS Config: localization is required");
  }

  assertCollectionsAreAddressable(config.collections?.global ?? []);

  // Extract client-safe configuration
  const clientSafeConfig: ClientSafeConfig = {
    appName: config.appName,
    localization: config.localization,
    collections: config.collections || { global: [], settings: [] },
    upload: {
      maxFileSize: config.upload.maxFileSize,
      minFiles: config.upload.minFiles,
      maxFiles: config.upload.maxFiles,
      allowedTypes: config.upload.allowedTypes,
      allowedExtensions: config.upload.allowedExtensions,
    },
    auth: config.auth
      ? {
          autoLogout: config.auth.autoLogout,
        }
      : undefined,
    features: {
      removeBackground: {
        enabled: isRemoveBackgroundEnabled(config),
      },
    },
  };

  return {
    /**
     * Full configuration (server-only)
     * CAUTION: This includes sensitive information.
     */
    server: config as Readonly<T>,

    /**
     * Client-safe configuration
     */
    client: clientSafeConfig as Readonly<ClientSafeConfig>,
  } as const;
}

/**
 * Type helper to extract config type
 */
export type CMSConfig<T extends CMSConfigInput = CMSConfigInput> = ReturnType<
  typeof createCMSConfig<T>
>;
