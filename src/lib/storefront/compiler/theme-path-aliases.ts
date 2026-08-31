import type { ThemeCompilerFile } from "./theme-compiler.types";

/**
 * The small, portable subset of TypeScript's `compilerOptions.paths` contract
 * that a Theme can safely use.  TanStack Start delegates path aliasing to the
 * project's tsconfig and Vite resolver; Morph reads that same file and feeds
 * one normalized representation to Monaco, Vite, and import protection.
 */
export type ThemePathAliasDiagnostic = Readonly<{
  code: "THEME_PATH_ALIASES_INVALID";
  message: string;
  filePath: string;
  line: number;
  column: number;
}>;

export type ThemePathAlias = Readonly<{
  /** Alias key without the trailing `/*` used by TypeScript. */
  key: string;
  /** Target path without the trailing `/*`, relative to `baseUrl`. */
  target: string;
  wildcard: boolean;
}>;

export type ThemePathAliasConfig = Readonly<{
  sourcePath: string | null;
  /** Normalized Theme-root-relative base URL. */
  baseUrl: string;
  paths: Readonly<Record<string, readonly string[]>>;
  aliases: readonly ThemePathAlias[];
  diagnostics: readonly ThemePathAliasDiagnostic[];
}>;

const CONFIG_PATHS = ["tsconfig.json", "jsconfig.json"] as const;

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function normalizeWorkspacePath(value: string): string | null {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function dirname(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(
  filePath: string,
  message: string,
): ThemePathAliasDiagnostic {
  return {
    code: "THEME_PATH_ALIASES_INVALID",
    message,
    filePath,
    line: 1,
    column: 1,
  };
}

function parseJsonc(content: string): unknown {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    const next = content[index + 1];
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
    } else if (character === "/" && next === "/") {
      index += 1;
      while (index + 1 < content.length && content[index + 1] !== "\n") {
        index += 1;
      }
    } else if (character === "/" && next === "*") {
      index += 1;
      while (index + 1 < content.length) {
        index += 1;
        if (content[index] === "*" && content[index + 1] === "/") {
          index += 1;
          break;
        }
        if (content[index] === "\n") withoutComments += "\n";
      }
    } else {
      withoutComments += character;
    }
  }

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index]!;
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(withoutComments[lookahead] ?? "")) lookahead += 1;
      if (withoutComments[lookahead] === "}" || withoutComments[lookahead] === "]") {
        continue;
      }
    }
    normalized += character;
  }
  return JSON.parse(normalized);
}

function cleanPattern(value: string): {
  key: string;
  wildcard: boolean;
} | null {
  const wildcard = value.endsWith("/*");
  const key = wildcard ? value.slice(0, -2) : value;
  if (!key || key.includes("*") || key.includes("\\")) return null;
  return { key, wildcard };
}

function cleanTarget(value: string): string | null {
  const target = value.replace(/\\/g, "/");
  if (target.startsWith("/") || /^[A-Za-z]:\//.test(target)) return null;
  if (target.includes("*") && !target.endsWith("/*")) return null;
  const withoutWildcard = target.endsWith("/*")
    ? target.slice(0, -2)
    : target;
  if (!withoutWildcard || withoutWildcard.split("/").includes("node_modules")) {
    return null;
  }

  // Keep leading `..` segments. TypeScript resolves a path target relative to
  // the effective baseUrl, so normalising the target by itself would silently
  // turn `../shared/*` into `shared/*` and make Monaco/Vite disagree with the
  // real compiler. The caller validates the joined path against the Theme
  // root before accepting it.
  const parts: string[] = [];
  for (const part of withoutWildcard.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.at(-1) !== "..") {
      if (parts.length > 0) parts.pop();
      else parts.push("..");
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || null;
}

type RelativeConfigValue<T> = {
  value: T;
  sourcePath: string;
};

type ResolvedThemePathOptions = {
  baseUrl?: RelativeConfigValue<string>;
  paths?: RelativeConfigValue<Record<string, unknown>>;
  diagnostics: ThemePathAliasDiagnostic[];
};

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Resolves only workspace-local relative `extends` chains. TypeScript also
 * accepts package-based config inheritance, but resolving that would require
 * reading an untrusted node_modules tree in the browser/build preflight. A
 * package or absolute extends therefore becomes an actionable diagnostic.
 */
function resolveExtendedConfigPath(
  configPath: string,
  extendsValue: string,
  byPath: ReadonlyMap<string, ThemeCompilerFile>,
): string | null {
  if (!extendsValue.startsWith("./") && !extendsValue.startsWith("../")) {
    return null;
  }
  const basePath = normalizeWorkspacePath(
    `${dirname(configPath)}/${extendsValue}`,
  );
  if (basePath === null || basePath.split("/").includes("node_modules")) {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.json`,
    `${basePath}.jsonc`,
    `${basePath}/tsconfig.json`,
  ];
  return candidates.find((candidate) => byPath.has(candidate)) ?? null;
}

function resolveThemePathOptions(
  configPath: string,
  byPath: ReadonlyMap<string, ThemeCompilerFile>,
  stack: readonly string[] = [],
): ResolvedThemePathOptions {
  if (stack.includes(configPath)) {
    return {
      diagnostics: [
        diagnostic(
          configPath,
          `Path alias config extends cycle detected: ${[...stack, configPath].join(" -> ")}.`,
        ),
      ],
    };
  }

  const configFile = byPath.get(configPath);
  if (!configFile) {
    return {
      diagnostics: [
        diagnostic(configPath, `Extended path alias config "${configPath}" was not found.`),
      ],
    };
  }

  const parsedResult = parseConfigFile(configFile.path, configFile.content);
  const diagnostics = [...parsedResult.diagnostics];
  if (!parsedResult.parsed) return { diagnostics };

  let inherited: ResolvedThemePathOptions = { diagnostics: [] };
  const rawExtends = parsedResult.parsed.extends;
  if (rawExtends !== undefined) {
    if (typeof rawExtends !== "string" || !rawExtends.trim()) {
      diagnostics.push(
        diagnostic(
          configPath,
          'tsconfig "extends" must be a non-empty relative workspace path.',
        ),
      );
    } else {
      const extendedPath = resolveExtendedConfigPath(
        configPath,
        rawExtends,
        byPath,
      );
      if (!extendedPath) {
        diagnostics.push(
          diagnostic(
            configPath,
            `tsconfig "extends" must resolve to an existing relative config inside the Theme workspace: "${rawExtends}".`,
          ),
        );
      } else {
        inherited = resolveThemePathOptions(extendedPath, byPath, [
          ...stack,
          configPath,
        ]);
        diagnostics.push(...inherited.diagnostics);
      }
    }
  }

  const compilerOptions = isRecord(parsedResult.parsed.compilerOptions)
    ? parsedResult.parsed.compilerOptions
    : {};
  const resolved: ResolvedThemePathOptions = {
    baseUrl: inherited.baseUrl,
    paths: inherited.paths,
    diagnostics,
  };
  if (hasOwn(compilerOptions, "baseUrl")) {
    if (typeof compilerOptions.baseUrl === "string") {
      resolved.baseUrl = {
        value: compilerOptions.baseUrl,
        sourcePath: configPath,
      };
    } else {
      diagnostics.push(
        diagnostic(configPath, "compilerOptions.baseUrl must be a string."),
      );
      delete resolved.baseUrl;
    }
  }
  if (hasOwn(compilerOptions, "paths")) {
    if (isRecord(compilerOptions.paths)) {
      resolved.paths = {
        value: compilerOptions.paths,
        sourcePath: configPath,
      };
    } else {
      diagnostics.push(diagnostic(configPath, "compilerOptions.paths must be an object."));
      delete resolved.paths;
    }
  }
  return resolved;
}

function parseConfigFile(
  filePath: string,
  content: string,
): {
  parsed: Record<string, unknown> | null;
  diagnostics: ThemePathAliasDiagnostic[];
} {
  try {
    const parsed: unknown = parseJsonc(content);
    if (!isRecord(parsed)) {
      return {
        parsed: null,
        diagnostics: [diagnostic(filePath, "Path alias config must be a JSON object.")],
      };
    }
    return { parsed, diagnostics: [] };
  } catch {
    return {
      parsed: null,
      diagnostics: [diagnostic(filePath, "Path alias config must contain valid JSON.")],
    };
  }
}

/**
 * Reads `tsconfig.json` (or `jsconfig.json` as a fallback) from the virtual
 * Theme filesystem.  Unsupported or unsafe entries are diagnostics rather
 * than silently ignored: otherwise Monaco and the build could resolve an
 * import to different files.
 */
export function readThemePathAliases(
  files: readonly ThemeCompilerFile[],
): ThemePathAliasConfig {
  const byPath = new Map(
    files.map((file) => [file.path.replace(/\\/g, "/").replace(/^\/+/, ""), file]),
  );
  const configFile = CONFIG_PATHS.map((path) => byPath.get(path)).find(Boolean);
  if (!configFile) {
    return {
      sourcePath: null,
      baseUrl: "",
      paths: {},
      aliases: [],
      diagnostics: [],
    };
  }

  const resolvedOptions = resolveThemePathOptions(configFile.path, byPath);
  const diagnostics = [...resolvedOptions.diagnostics];
  const rawBaseUrl = resolvedOptions.baseUrl?.value;
  let baseUrl = "";
  if (rawBaseUrl !== undefined) {
    const baseUrlSourcePath = resolvedOptions.baseUrl?.sourcePath ?? configFile.path;
    if (rawBaseUrl.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawBaseUrl)) {
      diagnostics.push(
        diagnostic(
          baseUrlSourcePath,
          "compilerOptions.baseUrl must stay inside the Theme workspace.",
        ),
      );
    } else {
      // An inherited baseUrl is relative to the config that declared it (the
      // same rule TypeScript applies to an extended tsconfig), not always the
      // top-level tsconfig selected above.
      const normalized = normalizeWorkspacePath(
        `${dirname(baseUrlSourcePath)}/${rawBaseUrl}`,
      );
      if (normalized === null) {
        diagnostics.push(
          diagnostic(
            baseUrlSourcePath,
            "compilerOptions.baseUrl cannot escape the Theme workspace.",
          ),
        );
      } else {
        baseUrl = normalized;
      }
    }
  }

  const paths: Record<string, readonly string[]> = {};
  const aliases: ThemePathAlias[] = [];
  const rawPaths = resolvedOptions.paths?.value;
  const pathsSourcePath = resolvedOptions.paths?.sourcePath ?? configFile.path;
  if (isRecord(rawPaths)) {
    for (const [rawKey, rawTargets] of Object.entries(rawPaths)) {
      const pattern = cleanPattern(rawKey);
      if (!pattern) {
        diagnostics.push(diagnostic(pathsSourcePath, `Invalid path alias key "${rawKey}".`));
        continue;
      }
      if (!Array.isArray(rawTargets) || rawTargets.some((target) => typeof target !== "string")) {
        diagnostics.push(
          diagnostic(
            pathsSourcePath,
            `Path alias "${rawKey}" must map to an array of strings.`,
          ),
        );
        continue;
      }
      const targets: string[] = [];
      for (const rawTarget of rawTargets) {
        const target = cleanTarget(rawTarget);
        const resolvedTarget = target
          ? normalizeWorkspacePath(`${baseUrl}/${target}`)
          : null;
        if (!target || !resolvedTarget || resolvedTarget.split("/").includes("node_modules")) {
          diagnostics.push(
            diagnostic(
              pathsSourcePath,
              `Path alias target "${rawTarget}" is outside the Theme workspace or unsupported.`,
            ),
          );
          continue;
        }
        // Monaco receives the original TypeScript pattern (including `*`),
        // while the Vite/graph representations below use a stripped target
        // plus an explicit wildcard flag.
        targets.push(rawTarget.replace(/\\/g, "/").endsWith("/*") ? `${target}/*` : target);
        aliases.push({ key: pattern.key, target, wildcard: pattern.wildcard });
      }
      if (targets.length > 0) paths[rawKey] = targets;
    }
  }

  return {
    sourcePath: configFile.path,
    baseUrl,
    paths,
    // TypeScript gives the longest matching pattern precedence. Keep that
    // ordering for both the graph scanner and Vite's resolver.
    aliases: aliases.sort((left, right) => right.key.length - left.key.length),
    diagnostics,
  };
}

function extensionCandidates(path: string): string[] {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];
  if (extensions.some((extension) => path.endsWith(extension))) return [path];
  return [path, ...extensions.map((extension) => `${path}${extension}`), ...extensions.map((extension) => `${path}/index${extension}`)];
}

function replaceAliasPattern(
  specifier: string,
  alias: ThemePathAlias,
): string | null {
  if (alias.wildcard) {
    if (specifier !== alias.key && !specifier.startsWith(`${alias.key}/`)) return null;
    return `${alias.target}${specifier.slice(alias.key.length)}`;
  }
  return specifier === alias.key ? alias.target : null;
}

/** Resolves a Theme import using the same aliases used by Vite/TypeScript. */
export function resolveThemePathAlias(
  specifier: string,
  files: ReadonlyMap<string, ThemeCompilerFile>,
  config: ThemePathAliasConfig,
): string | null {
  for (const alias of config.aliases) {
    const replaced = replaceAliasPattern(specifier, alias);
    if (replaced === null) continue;
    const root = normalizePath(`${config.baseUrl}/${replaced}`);
    const resolved = extensionCandidates(root).find((candidate) => files.has(candidate));
    if (resolved) return resolved;
  }
  return null;
}

/**
 * TypeScript also resolves a bare import from `baseUrl` when no `paths` entry
 * matches. Only return a file that is already present in the virtual Theme;
 * package names therefore continue through the normal dependency allowlist.
 */
export function resolveThemeBaseUrlImport(
  specifier: string,
  files: ReadonlyMap<string, ThemeCompilerFile>,
  config: ThemePathAliasConfig,
): string | null {
  if (!config.baseUrl || specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }
  const root = normalizePath(`${config.baseUrl}/${specifier}`);
  return extensionCandidates(root).find((candidate) => files.has(candidate)) ?? null;
}

export type ThemeViteAlias = Readonly<{
  find: string | RegExp;
  replacement: string;
}>;

/** Builds Vite's controlled alias list without executing customer config. */
export function createThemeViteAliases(
  config: ThemePathAliasConfig,
  workspaceRoot: string,
): ThemeViteAlias[] {
  return config.aliases.map((alias) => ({
    find: alias.wildcard
      ? alias.key
      : new RegExp(`^${alias.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: `${workspaceRoot}/${normalizePath(`${config.baseUrl}/${alias.target}`)}`,
  }));
}

/** Serializes aliases for the generated Sandbox Vite config. */
export function renderThemeViteAliases(
  config: ThemePathAliasConfig,
  workspaceRoot: string,
): string {
  return JSON.stringify(
    config.aliases.map((alias) => ({
      key: alias.key,
      target: `${workspaceRoot}/${normalizePath(`${config.baseUrl}/${alias.target}`)}`,
      wildcard: alias.wildcard,
    })),
  );
}

/** Compiler-file adapter for callers that do not keep a ThemeCompilerFile map. */
export function themePathAliasConfigFromFiles(
  files: readonly ThemeCompilerFile[],
): ThemePathAliasConfig {
  return readThemePathAliases(files);
}
