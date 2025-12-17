/**
 * CMS Configuration Factory
 *
 * This module provides a factory function to create type-safe CMS configuration.
 * It handles:
 * - Configuration validation
 * - Type safety
 * - Separation of server-only and client-safe parts
 */

import { localization } from "../config/localization";

/**
 * Configuration types
 */
export interface CMSConfigInput {
    appName: string;
    database: {
        connectionString: string | undefined;
    };
    collections: any[];
    settings: any[];
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
    email: any;
    trustedOrigins: string[];
}

/**
 * Client-safe configuration (subset of full config)
 */
export interface ClientSafeConfig {
    appName: string;
    localization: typeof localization;
    upload: {
        maxFileSize: number;
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
}

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
        upload: {
            maxFileSize: config.upload.maxFileSize,
            maxFiles: config.upload.maxFiles,
            allowedTypes: config.upload.allowedTypes,
            allowedExtensions: config.upload.allowedExtensions,
        },
        auth: config.auth
            ? {
                  autoLogout: config.auth.autoLogout,
              }
            : undefined,
    };

    return {
        /**
         * Full configuration (server-only)
         * Use this in server components and server actions
         */
        server: config as Readonly<T>,

        /**
         * Client-safe configuration
         * Use this in client components
         */
        client: clientSafeConfig as Readonly<ClientSafeConfig>,

        /**
         * Get full config (server-only)
         */
        getServerConfig: () => config as Readonly<T>,

        /**
         * Get client-safe config
         */
        getClientConfig: () => clientSafeConfig as Readonly<ClientSafeConfig>,
    } as const;
}

/**
 * Type helper to extract config type
 */
export type CMSConfig<T extends CMSConfigInput = CMSConfigInput> = ReturnType<typeof createCMSConfig<T>>;
