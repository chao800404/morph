import type * as NodeFs from "node:fs";
import type * as NodePath from "node:path";

/**
 * Morph's guard for a Vite Web Worker bundle, beside the import guard.
 *
 * A worker (`?worker`, `?sharedworker`, `new Worker(new URL(...))`) is its
 * own bundle, built with `worker.plugins` only. The import guard runs there
 * first, but three things reach a worker bundle without passing through it:
 *
 * - **Its entry.** Vite resolves `new Worker(new URL(...))` with its own
 *   resolver and hands the file to the worker bundler as the entry, which no
 *   module imports. An entry is checked like an import from the Theme.
 * - **Ids another resolver returned.** A resolver hook is answered by
 *   whichever plugin returns first. Once the worker is built, every module is
 *   placed by its physical path (symlinks followed): inside the pinned
 *   dependency tree it belongs to the package its path names there, inside
 *   the workspace it is the Theme's, anywhere else it is refused. A virtual
 *   (`\0`) id is either a wrapper around such a path (a package's CommonJS
 *   proxy), placed by that path, or one of the bundlers' own helpers named in
 *   `KNOWN_VIRTUAL`; any other is refused. A package imported from the Theme
 *   (or from a helper) must be approved; imports between packages of the
 *   pinned tree are the packages' own, as the import guard leaves them.
 * - **Files Vite reads itself.** A stylesheet's `@import` and `url()`, and an
 *   asset's `new URL("…", import.meta.url)`, are resolved and read by Vite's
 *   own resolver, outside the module graph. A worker has no document to
 *   style, so a stylesheet is refused before it is read. A `new URL(…)` that
 *   names `import.meta.url` in a Theme module must name a plain relative or
 *   root-relative string literal whose file lies in the workspace or in an
 *   approved package; anything else is refused. The transform is an ordinary
 *   one, so it sees the code after the TypeScript transform and before
 *   Vite's `import.meta.url` plugins.
 *
 * Self-contained, so a generated config embeds it as source
 * (`themeWorkerBundleGuardPluginSource`) and an in-process build calls it.
 */
export function createThemeWorkerBundleGuard(options: {
  fs: typeof NodeFs;
  path: typeof NodePath;
  /** Approved package names. */
  allowedPackages: { has(name: string): boolean };
  workspaceRoot: string;
  /** The pinned dependency tree: the workspace's node_modules, the toolchain's. */
  dependencyRoots: readonly string[];
}) {
  const { fs, path, allowedPackages, workspaceRoot, dependencyRoots } = options;
  const slash = (value: string) => value.replace(/\\/g, "/");
  const real = (file: string): string | null => {
    try {
      return slash(fs.realpathSync(file));
    } catch {
      return null;
    }
  };
  const present = (values: ReadonlyArray<string | null>): string[] =>
    [...new Set(values)].filter((value): value is string => Boolean(value));
  const workspaceRoots = present([
    slash(path.resolve(workspaceRoot)),
    real(workspaceRoot),
  ]);
  const packageRoots = present(dependencyRoots.map((value) => real(value)));
  const under = (file: string, within: readonly string[]) =>
    within.some((root) => file === root || file.startsWith(root + "/"));
  // The bundlers' own helper modules a worker bundle may hold.
  const KNOWN_VIRTUAL = new Set([
    "commonjsHelpers.js",
    "vite/preload-helper.js",
    "vite/modulepreload-polyfill.js",
    "rolldown/runtime.js",
  ]);
  const CSS = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/;

  type Place =
    | { kind: "package"; name: string }
    | { kind: "theme" }
    | { kind: "helper" }
    | { kind: "refused"; code: string; detail: string };

  const unverified = (detail: string): Place => ({
    kind: "refused",
    code: "WORKER_MODULE_UNVERIFIED",
    detail,
  });

  const place = (id: string): Place => {
    let file = id;
    if (id.startsWith("\0")) {
      const rest = id.slice(1).split("?")[0]!;
      if (KNOWN_VIRTUAL.has(rest)) return { kind: "helper" };
      if (!path.isAbsolute(rest))
        return unverified("is a virtual module Morph does not know");
      file = rest;
    }
    file = file.split("?")[0]!;
    if (!path.isAbsolute(file)) return unverified("names no file");
    const physical = real(file);
    if (!physical) return unverified("names a file that does not exist");
    const packageRoot = packageRoots.find((root) => under(physical, [root]));
    if (packageRoot) {
      const inner = "/node_modules" + physical.slice(packageRoot.length);
      const parts = inner
        .slice(inner.lastIndexOf("/node_modules/") + "/node_modules/".length)
        .split("/");
      const name = parts[0]!.startsWith("@")
        ? parts[0] + "/" + parts[1]
        : parts[0]!;
      if (!name || name.startsWith(".")) {
        return unverified("lies in the dependency tree outside any package");
      }
      return { kind: "package", name };
    }
    if (under(physical, workspaceRoots)) return { kind: "theme" };
    return {
      kind: "refused",
      code: "WORKSPACE_PATH_ESCAPE",
      detail: "resolves outside the workspace",
    };
  };

  const query = (id: string) => new URLSearchParams(id.split("?")[1] ?? "");

  /** Each `new URL(...)` whose arguments name import.meta.url: its literal, or null. */
  const importMetaUrlReferences = (code: string): Array<string | null> => {
    const found: Array<string | null> = [];
    const start = /\bnew\s+URL\s*\(/g;
    while (start.exec(code) !== null) {
      let index = start.lastIndex;
      let depth = 1;
      let quote: string | null = null;
      for (; index < code.length && depth > 0; index++) {
        const char = code[index];
        if (quote) {
          if (char === "\\") index++;
          else if (char === quote) quote = null;
          continue;
        }
        if (char === "'" || char === '"' || char === "`") quote = char;
        else if (char === "(") depth++;
        else if (char === ")") depth--;
      }
      const args = code.slice(
        start.lastIndex,
        depth === 0 ? index - 1 : code.length,
      );
      if (depth !== 0 || /\bimport\s*\.\s*meta\s*\.\s*url\b/.test(args)) {
        const literal =
          /^\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)")\s*,\s*import\.meta\.url\s*,?\s*$/.exec(
            args,
          );
        found.push(depth === 0 && literal ? (literal[1] ?? literal[2])! : null);
      }
    }
    return found;
  };

  return {
    name: "morph:worker-bundle-guard",
    load: {
      order: "pre" as const,
      handler(this: { error(message: string): never }, id: string) {
        const file = id.replace(/^\0/, "").split("?")[0]!;
        if (CSS.test(file)) {
          this.error(
            'WORKER_CSS_UNSUPPORTED: Worker module "' +
              id +
              '" is a stylesheet; a Web Worker has no document to style, and its @import and url() would be read outside the import guard.',
          );
        }
        return null;
      },
    },
    transform(
      this: { error(message: string): never },
      code: string,
      id: string,
    ) {
      const params = query(id);
      // Vite's own wrapper for a `?worker` import: the worker's code is
      // bundled, and guarded, as a worker bundle of its own.
      if (
        (params.has("worker") || params.has("sharedworker")) &&
        !params.has("worker_file")
      ) {
        return null;
      }
      // A file's text or address, not code that runs.
      if (params.has("raw") || params.has("url")) return null;
      if (place(id).kind !== "theme") return null;
      const refuse = (why: string): never =>
        this.error(
          'WORKER_ASSET_URL_UNSUPPORTED: Worker module "' +
            id +
            '" ' +
            why +
            ".",
        );
      for (const literal of importMetaUrlReferences(code)) {
        if (literal === null) {
          refuse(
            "passes import.meta.url to new URL() with something other than a plain string literal",
          );
          continue;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(literal) || literal.startsWith("//"))
          continue;
        const target = literal.split(/[?#]/)[0]!;
        let file: string;
        if (target.startsWith("./") || target.startsWith("../")) {
          file = path.resolve(path.dirname(id.split("?")[0]!), target);
        } else if (target.startsWith("/")) {
          file = path.resolve(workspaceRoot, "." + target);
        } else {
          refuse(
            'names "' +
              literal +
              '" in new URL(); only a relative or root-relative path is supported',
          );
          continue;
        }
        if (!fs.existsSync(file)) {
          if (!under(slash(path.resolve(file)), workspaceRoots)) {
            refuse(
              'names "' + literal + '", which resolves outside the workspace',
            );
          }
          continue;
        }
        const asset = place(file);
        if (asset.kind === "theme") continue;
        if (asset.kind === "package" && allowedPackages.has(asset.name))
          continue;
        refuse(
          'names "' +
            literal +
            '", which ' +
            (asset.kind === "package"
              ? 'is in package "' +
                asset.name +
                '", which is not an approved dependency'
              : asset.kind === "refused"
                ? asset.detail
                : "is not a Theme file"),
        );
      }
      return null;
    },
    buildEnd(
      this: {
        error(message: string): never;
        getModuleIds(): Iterable<string>;
        getModuleInfo(id: string): {
          isEntry?: boolean;
          importers?: readonly string[];
          dynamicImporters?: readonly string[];
        } | null;
      },
      error?: Error,
    ) {
      if (error) return;
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info) continue;
        const placed = place(id);
        if (placed.kind === "refused") {
          this.error(
            placed.code + ': Worker module "' + id + '" ' + placed.detail + ".",
          );
        }
        if (placed.kind !== "package" || allowedPackages.has(placed.name))
          continue;
        if (info.isEntry) {
          this.error(
            'UNAPPROVED_DEPENDENCY: Theme starts a Web Worker from "' +
              id +
              '" in package "' +
              placed.name +
              '", which is not an approved dependency.',
          );
        }
        for (const importer of [
          ...(info.importers ?? []),
          ...(info.dynamicImporters ?? []),
        ]) {
          if (place(importer).kind === "package") continue;
          this.error(
            'UNAPPROVED_DEPENDENCY: Theme worker module "' +
              importer +
              '" imports "' +
              id +
              '" from package "' +
              placed.name +
              '", which is not an approved dependency.',
          );
        }
      }
    },
  };
}

/**
 * `createThemeWorkerBundleGuard` as plugin source for a generated config,
 * which imports `fs` and `path`; the options are expressions there.
 */
export function themeWorkerBundleGuardPluginSource(options: {
  allowedPackages: string;
  workspaceRoot: string;
  dependencyRoots: string;
}): string {
  return `(${createThemeWorkerBundleGuard.toString()})({
  fs,
  path,
  allowedPackages: ${options.allowedPackages},
  workspaceRoot: ${options.workspaceRoot},
  dependencyRoots: ${options.dependencyRoots},
})`;
}
