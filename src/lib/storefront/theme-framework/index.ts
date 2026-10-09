import { astroFramework } from "./astro.framework";
import { tanstackStartFramework } from "./tanstack-start.framework";
import {
  THEME_FRAMEWORK_IDS,
  UNRECORDED_THEME_FRAMEWORK,
  type ThemeFrameworkAdapter,
} from "./theme-framework.types";

export type {
  ThemeFrameworkAdapter,
  ThemeFrameworkId,
} from "./theme-framework.types";
export {
  THEME_FRAMEWORK_IDS,
  UNRECORDED_THEME_FRAMEWORK,
} from "./theme-framework.types";

/** Every framework Morph can preview and build. */
export const THEME_FRAMEWORKS: readonly ThemeFrameworkAdapter[] = [
  tanstackStartFramework,
];

/**
 * Frameworks a caller has to ask for. Astro is built only where the server
 * turns it on (`MORPH_ASTRO_THEMES=1`, never in production;
 * theme-build-service.factory) and passes `astroThemes`; everywhere else —
 * every Live Preview, and every build path not given the switch — it is
 * refused exactly as before it had an adapter.
 */
export type ThemeFrameworkOptions = Readonly<{
  /** The server's Astro switch (docs/astro-theme-plan.md 8.2). */
  astroThemes?: boolean;
}>;

function availableFrameworks(
  options: ThemeFrameworkOptions,
): readonly ThemeFrameworkAdapter[] {
  return options.astroThemes === true
    ? [...THEME_FRAMEWORKS, astroFramework]
    : THEME_FRAMEWORKS;
}

export type ThemeFrameworkUnavailableCode =
  "THEME_FRAMEWORK_UNAVAILABLE" | "THEME_FRAMEWORK_UNKNOWN";

/**
 * A recorded framework Morph cannot serve. Never answered by serving the
 * Theme through another framework: building or previewing a project with a
 * framework it was not written for would succeed, or fail, for reasons that
 * have nothing to do with the project.
 */
export class ThemeFrameworkUnavailableError extends Error {
  readonly code: ThemeFrameworkUnavailableCode;
  /** What the record said, as it said it. */
  readonly framework: string;

  constructor(code: ThemeFrameworkUnavailableCode, framework: string) {
    super(
      code === "THEME_FRAMEWORK_UNAVAILABLE"
        ? `THEME_FRAMEWORK_UNAVAILABLE: The Theme is recorded as a "${framework}" project, and Morph cannot preview or build ${framework} projects yet. It is not built or previewed as another framework.`
        : `THEME_FRAMEWORK_UNKNOWN: The Theme is recorded with framework "${framework}", which Morph does not know. It is not built or previewed as another framework.`,
    );
    this.name = "ThemeFrameworkUnavailableError";
    this.code = code;
    this.framework = framework;
  }
}

export type ThemeFrameworkResolution =
  | Readonly<{ ok: true; framework: ThemeFrameworkAdapter }>
  | Readonly<{
      ok: false;
      code: ThemeFrameworkUnavailableCode;
      framework: string;
      message: string;
    }>;

/**
 * The adapter for the framework a build or a preview records.
 *
 * Absent (`null` or `undefined`) is `UNRECORDED_THEME_FRAMEWORK`, so every
 * record from before the framework was recorded reads exactly as it did. A
 * recorded id without an adapter available to this caller (`astro`, unless
 * `options.astroThemes`) or a value that is no framework id at all is
 * refused; nothing falls back.
 */
export function resolveThemeFramework(
  recorded: string | null | undefined,
  options: ThemeFrameworkOptions = {},
): ThemeFrameworkResolution {
  const id = recorded ?? UNRECORDED_THEME_FRAMEWORK;
  const framework = availableFrameworks(options).find(
    (candidate) => candidate.id === id,
  );
  if (framework) return { ok: true, framework };
  const error = new ThemeFrameworkUnavailableError(
    (THEME_FRAMEWORK_IDS as readonly string[]).includes(id)
      ? "THEME_FRAMEWORK_UNAVAILABLE"
      : "THEME_FRAMEWORK_UNKNOWN",
    id,
  );
  return {
    ok: false,
    code: error.code,
    framework: id,
    message: error.message,
  };
}

/**
 * The framework a Theme's preview and build go through, by the framework its
 * record names (`resolveThemeFramework`). Throws
 * `ThemeFrameworkUnavailableError` for one Morph cannot serve.
 *
 * Called without a record, it is the unrecorded framework, which also serves
 * the older single-entry Themes that its `detect` does not claim.
 */
export function themeFramework(
  recorded?: string | null,
  options: ThemeFrameworkOptions = {},
): ThemeFrameworkAdapter {
  const resolved = resolveThemeFramework(recorded, options);
  if (!resolved.ok) {
    throw new ThemeFrameworkUnavailableError(resolved.code, resolved.framework);
  }
  return resolved.framework;
}
