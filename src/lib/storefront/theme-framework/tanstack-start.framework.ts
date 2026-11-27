import { assertThemePrerenderArtifacts } from "../compiler/theme-prerender";
import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  nativeRefusedReadsMessage,
} from "../compiler/theme-prerender-content";
import { THEME_FRAMEWORK_ROUTES } from "./theme-routes";
import { THEME_START_TOOLCHAIN } from "../compiler/theme-start-toolchain";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "../compiler/theme-preview-dev-server";
import { planThemeSandboxWorkspace } from "../compiler/theme-sandbox-workspace";
import { withThemeStartBuildIdentity } from "../compiler/theme-morph-sdk";
import { deriveThemeSourceRouterFramework } from "../theme-source-runtime-contract";
import type { ThemeFrameworkAdapter } from "./theme-framework.types";
import {
  NATIVE_START_COMPILER_ID,
  collectNativeStartArtifact,
  nativeAdapterRefusalMessage,
  nativeAllowedPackages,
  planNativeStartBuild,
} from "./tanstack-start-native-build";
import { NATIVE_PROOF_VERSION } from "./native-start-proof";
import { NATIVE_ADAPTER_REFUSAL_PATH } from "./tanstack-start-native-wrapper";

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
    // The generated bootstrap and the import protection both start from it.
    entryFile: "required",
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
      // The pinned Start version, the Morph SDK the build injects, the
      // hide guard it compiles in (theme-morph-sdk.ts) and the SDK
      // resolution proof it carries (native-start-proof.ts): any changing
      // must change the identity. A native build made before the proof is
      // therefore never reused as one that carries it.
      compilerIdentity: () => ({
        id: NATIVE_START_COMPILER_ID,
        version: `${withThemeStartBuildIdentity(THEME_START_TOOLCHAIN.reactStart)}.${NATIVE_PROOF_VERSION}`,
      }),
      routeRegistry: (files) => {
        const registry = THEME_FRAMEWORK_ROUTES["tanstack-start"](files);
        return registry.valid ? registry : null;
      },
      allowedPackages: nativeAllowedPackages,
      plan: planNativeStartBuild,
      // A Theme whose read failure is fatal (Starter 32) stops the prerender
      // on the first, content-less pass's refused read: the build exits
      // non-zero, and the record is what sends it to the sealed pass. A
      // refusal in the sealed pass still fails the build.
      failedBuildCause(outputs) {
        // A Cloudflare plugin option the loader shim refused stops the build
        // when the config is loaded; the shim's record says which.
        const adapter = outputs.get(NATIVE_ADAPTER_REFUSAL_PATH);
        if (adapter !== undefined) {
          return {
            stage: "native-plan",
            message: nativeAdapterRefusalMessage(adapter),
          };
        }
        const refused = outputs.get(NATIVE_PRERENDER_REFUSED_READS_PATH);
        return refused === undefined
          ? null
          : {
              stage: "prerender-content",
              message: nativeRefusedReadsMessage(refused),
            };
      },
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
