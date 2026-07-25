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
 * Context handed to a collection's `loadData` by the dynamic dashboard routes.
 * `search` has already passed `dashboardSearchSchema` in the route.
 */
export interface CollectionLoadContext {
  queryClient: QueryClient;
  params: Record<string, string>;
  search: DashboardSearch;
}

/**
 * Configuration types
 */
export interface CollectionItem {
  title: string;
  slug: string;
  icon?: string;
  label?: string;
  items?: {
    title: string;
    slug: string;
    label?: string;
    component?: ComponentType;
    /** Suspense fallback while `component` loads. Defaults to a page spinner. */
    loader?: ComponentType;
    loadData?: (context: CollectionLoadContext) => Promise<void> | void;
  }[];
  component?: ComponentType;
  /**
   * Suspense fallback rendered while `component`'s chunk loads.
   *
   * Defaults to a centred spinner. Give a view its own skeleton when its
   * in-card loading state is also a skeleton, so the code wait and the data
   * wait look like one state instead of two different ones. Unlike
   * `component`, this must be imported eagerly — a lazy loader would need a
   * loader of its own.
   */
  loader?: ComponentType;
  loadData?: (context: CollectionLoadContext) => Promise<void> | void;
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
