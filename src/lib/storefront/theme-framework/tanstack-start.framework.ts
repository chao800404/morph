import { assertThemePrerenderArtifacts } from "../compiler/theme-prerender";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "../compiler/theme-preview-dev-server";
import { planThemeSandboxWorkspace } from "../compiler/theme-sandbox-workspace";
import { deriveThemeSourceRouterFramework } from "../theme-source-runtime-contract";
import type { ThemeFrameworkAdapter } from "./theme-framework.types";
import {
  collectNativeStartArtifact,
  planNativeStartBuild,
} from "./tanstack-start-native-build";

const WORKER_ENTRY = "runtime/server/index.js";
const CLIENT_ASSETS_DIRECTORY = "runtime/client";
const PREVIEW_ENTRY = "preview/index.html";

/**
 * TanStack Start, as Morph builds and previews it today.
 *
 * Everything here was already Morph's behaviour; this module only gives it one
 * address. The workspace planner (theme-sandbox-workspace.ts) still generates
 * the Start-specific config and entry files, and it also lays out the older
 * single-entry Themes that have no router; both are this adapter's until a
 * second framework needs to tell them apart.
 */
export const tanstackStartFramework: ThemeFrameworkAdapter = {
  id: "tanstack-start",
  detect: (files) =>
    deriveThemeSourceRouterFramework(files) === "tanstack-start",
  planWorkspace: planThemeSandboxWorkspace,
  preview: {
    // A Start preview runs the Start server, at the root of its origin; the
    // browser-only preview is served under the platform base path.
    framePath: (runtime) =>
      runtime === "start" ? "/" : THEME_PREVIEW_SERVER_BASE_PATH,
  },
  build: {
    artifactEntry: (routeRegistry) =>
      routeRegistry ? PREVIEW_ENTRY : "index.html",
    verifyArtifact({ artifactPaths, routeRegistry, contentSnapshot }) {
      if (!routeRegistry) return;
      assertThemePrerenderArtifacts(
        contentSnapshot,
        routeRegistry,
        artifactPaths,
      );
      if (!artifactPaths.has(WORKER_ENTRY)) {
        throw new Error(
          `INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce ${WORKER_ENTRY}.`,
        );
      }
      if (!artifactPaths.has(PREVIEW_ENTRY)) {
        throw new Error(
          `INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce ${PREVIEW_ENTRY}.`,
        );
      }
      if (
        ![...artifactPaths].some((path) =>
          path.startsWith(`${CLIENT_ASSETS_DIRECTORY}/`),
        )
      ) {
        throw new Error(
          "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce runtime client assets.",
        );
      }
    },
    manifestMetadata: (routeRegistry) =>
      routeRegistry
        ? {
            router: "tanstack-start",
            runtime: "cloudflare-worker",
            workerEntry: WORKER_ENTRY,
            clientAssetsDirectory: CLIENT_ASSETS_DIRECTORY,
            previewRuntime: "tanstack-router-client",
            previewEntry: PREVIEW_ENTRY,
            routes: routeRegistry.routes,
          }
        : undefined,
    native: {
      plan: planNativeStartBuild,
      collect: collectNativeStartArtifact,
      artifactEntry: WORKER_ENTRY,
      verifyArtifact({ artifactPaths, routeRegistry, contentSnapshot }) {
        // The pages the build's content says are prerendered, by the same
        // rule as a platform build; whether to prerender is the project's
        // own config's to say, and a build that does not is refused here.
        if (routeRegistry) {
          assertThemePrerenderArtifacts(
            contentSnapshot,
            routeRegistry,
            artifactPaths,
          );
        }
        if (!artifactPaths.has(WORKER_ENTRY)) {
          throw new Error(
            `INCOMPLETE_START_ARTIFACT: The native build did not produce ${WORKER_ENTRY}.`,
          );
        }
        if (
          ![...artifactPaths].some((path) =>
            path.startsWith(`${CLIENT_ASSETS_DIRECTORY}/`),
          )
        ) {
          throw new Error(
            "INCOMPLETE_START_ARTIFACT: The native build did not produce runtime client assets.",
          );
        }
      },
      manifestMetadata: (routeRegistry) => ({
        router: "tanstack-start",
        runtime: "cloudflare-worker",
        build: "native",
        workerEntry: WORKER_ENTRY,
        clientAssetsDirectory: CLIENT_ASSETS_DIRECTORY,
        ...(routeRegistry ? { routes: routeRegistry.routes } : {}),
      }),
    },
  },
};
