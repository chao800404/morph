import {
  GENERATED_SANDBOX_PLATFORM_TOOLS,
  GENERATED_SANDBOX_TOOLCHAINS,
} from "./theme-toolchains.generated";
import type { ThemeFrameworkId } from "./theme-framework.types";

/**
 * The toolchains the Sandbox image installs, as the image's own manifests
 * describe them (scripts/generate-sandbox-toolchains.mjs). This registry is the
 * only source of a toolchain's directory: a build names a toolchain by its
 * identity, and the directory comes from here, never from a Theme or a request.
 *
 * An identity is the SHA-256 of the toolchain's canonical manifest: exact
 * package set, lockfile, every installed position, Node, npm, base image and
 * platform. It is a compatibility and provenance check, made in the container
 * before Theme code runs; it is not tamper evidence (processes in the
 * container run as root).
 */
export type ThemeToolchain = Readonly<{
  id: string;
  framework: ThemeFrameworkId;
  /** Absolute directory in the Sandbox image. */
  root: string;
  /** Where its manifest is; its SHA-256 must equal `id`. */
  manifestPath: string;
}>;

const TOOLCHAINS: readonly ThemeToolchain[] = GENERATED_SANDBOX_TOOLCHAINS.map(
  (toolchain) => ({
    id: toolchain.id,
    framework: toolchain.framework as ThemeFrameworkId,
    root: toolchain.root,
    manifestPath: `${toolchain.root}/toolchain.manifest.json`,
  }),
);

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The registered toolchain with this identity, or null. */
export function themeToolchainById(id: string): ThemeToolchain | null {
  if (!SHA256_HEX.test(id)) return null;
  return TOOLCHAINS.find((toolchain) => toolchain.id === id) ?? null;
}

/**
 * The registry's toolchain for a framework. Asked in two places only: when a
 * build record is created (which then records the identity, and every later
 * step reads that, never this again), and by a Live Preview, which has no
 * build record.
 */
export function themeToolchainForFramework(
  framework: ThemeFrameworkId,
): ThemeToolchain {
  const matches = TOOLCHAINS.filter(
    (toolchain) => toolchain.framework === framework,
  );
  if (matches.length !== 1) {
    throw new Error(
      `THEME_TOOLCHAIN_UNAVAILABLE: ${matches.length} registered toolchains for framework "${framework}"; a new build needs exactly one.`,
    );
  }
  return matches[0];
}

/** A short form for logs and screens; never stored or compared. */
export function shortToolchainId(id: string): string {
  return id.slice(0, 12);
}

/**
 * Platform tools: the Wrangler that deploys a release and serves a Build
 * Preview. Fixed by the platform, never switched by a Theme's framework. A
 * separation of tool versions, not a security boundary inside one container.
 */
export const SANDBOX_PLATFORM_ROOT = GENERATED_SANDBOX_PLATFORM_TOOLS.root;
export const SANDBOX_PLATFORM_WRANGLER_BIN = `${SANDBOX_PLATFORM_ROOT}/node_modules/.bin/wrangler`;

/** Every registered toolchain, for tests and the registry's own checks. */
export function registeredThemeToolchains(): readonly ThemeToolchain[] {
  return TOOLCHAINS;
}
