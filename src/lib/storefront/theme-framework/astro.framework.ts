import { assertThemePrerenderArtifacts } from "../compiler/theme-prerender";
import {
  astroPrerenderRecordsFailure,
  astroRefusedReadsFailure,
  astroRouteRegistry,
} from "./astro-native-prerender";
import {
  collectNativeAstroArtifact,
  nativeAstroAllowedPackages,
  nativeAstroCompilerIdentity,
  planNativeAstroBuild,
} from "./astro-native-build";
import type { ThemeFrameworkAdapter } from "./theme-framework.types";

const CLIENT_ASSETS_DIRECTORY = "runtime/client";
const ASTRO_CONFIG = /^astro\.config\.(mjs|js|ts|mts)$/;

/** Why the part of Astro asked for does not exist yet, and which step adds it. */
const unavailable = (what: string, step: string) =>
  new Error(
    `THEME_FRAMEWORK_UNAVAILABLE: ${what} is not available for Astro Themes yet (docs/astro-theme-plan.md ${step}).`,
  );

/**
 * Astro, as far as Morph builds it: a native build only, behind the server's
 * `MORPH_ASTRO_THEMES` switch (theme-framework/index.ts, `astroThemes`), and
 * never in production until certification (docs/astro-theme-plan.md A8).
 *
 * There is no platform build of an Astro project and no Live Preview yet
 * (A6); asking for either is refused by name rather than answered with
 * Start's. The worker entry is whatever the Worker config the build wrote
 * names (`collectNativeAstroArtifact`); Astro's is `entry.mjs`.
 */
export const astroFramework: ThemeFrameworkAdapter = {
  id: "astro",
  detect: (files) => files.some((file) => ASTRO_CONFIG.test(file.path)),
  planWorkspace: () => {
    throw unavailable("A Live Preview", "A6");
  },
  preview: {
    framePath: () => "/",
  },
  build: {
    artifactEntry: () => {
      throw unavailable("A platform build", "5");
    },
    verifyArtifact: () => {
      throw unavailable("A platform build", "5");
    },
    manifestMetadata: () => {
      throw unavailable("A platform build", "5");
    },
    native: {
      compilerIdentity: nativeAstroCompilerIdentity,
      routeRegistry: astroRouteRegistry,
      allowedPackages: nativeAstroAllowedPackages,
      plan: planNativeAstroBuild,
      collect: collectNativeAstroArtifact,
      artifactEntry: "runtime/server/entry.mjs",
      verifyArtifact({ artifactPaths, routeRegistry, contentSnapshot }) {
        if (routeRegistry) {
          assertThemePrerenderArtifacts(
            contentSnapshot,
            routeRegistry,
            artifactPaths,
          );
        }
        if (!artifactPaths.has("runtime/server/entry.mjs")) {
          throw new Error(
            "INCOMPLETE_ASTRO_ARTIFACT: The native build did not produce runtime/server/entry.mjs.",
          );
        }
        if (
          ![...artifactPaths].some((path) =>
            path.startsWith(`${CLIENT_ASSETS_DIRECTORY}/`),
          )
        ) {
          throw new Error(
            "INCOMPLETE_ASTRO_ARTIFACT: The native build did not produce client assets.",
          );
        }
      },
      manifestMetadata: (routeRegistry) => ({
        framework: "astro",
        runtime: "cloudflare-worker",
        build: "native",
        workerEntry: "runtime/server/entry.mjs",
        clientAssetsDirectory: CLIENT_ASSETS_DIRECTORY,
        ...(routeRegistry ? { routes: routeRegistry.routes } : {}),
      }),
      prerenderRecordsFailure(outputs, nonce) {
        const failure = astroPrerenderRecordsFailure(outputs, nonce);
        if (!failure) return null;
        return {
          // A refused read is what the build passes rebuild with content
          // for; anything else is the build's own failure.
          stage:
            failure.code === "NATIVE_PRERENDER_CONTENT_UNAVAILABLE"
              ? "prerender-content"
              : "prerender-records",
          message: failure.message,
        };
      },
      failedBuildCause(outputs, nonce) {
        const failure = astroRefusedReadsFailure(outputs, nonce);
        return failure
          ? { stage: "prerender-content", message: failure.message }
          : null;
      },
    },
  },
};
