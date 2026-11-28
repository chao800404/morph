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
 *   style, so a stylesheet is refused before it is read. In a Theme module,
 *   read as a parsed program, every `import.meta.url` must be the second
 *   argument of a `new URL()` whose first is a plain string, and every file
 *   Vite could read for that string (the build resolver's answer and Vite's
 *   fallback paths) must lie in the workspace or an approved package;
 *   anything else is refused. The transform is an ordinary one, so it sees
 *   the code after the TypeScript transform and before Vite's
 *   `import.meta.url` plugins.
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
  // The bundlers' own helper modules a worker bundle may hold, by exact id.
  const KNOWN_VIRTUAL = new Set([
    "\0commonjsHelpers.js",
    "\0vite/preload-helper.js",
    "\0vite/modulepreload-polyfill.js",
    "\0vite/dynamic-import-helper.js",
    "\0vite/wasm-helper.js",
    "\0rolldown/runtime.js",
    "\0commonjs-dynamic-modules",
  ]);
  // Vite's empty stub for a module a browser bundle leaves out (a Node
  // built-in, a package's `browser: false`); it imports nothing.
  const BROWSER_EXTERNAL = /^\0?__vite-browser-external(?::[^?]*)?$/;
  // The CommonJS plugin's wrappers around a file: the only virtual ids that
  // wrap a path a worker bundle may hold, placed by that path.
  const COMMONJS_WRAPPER = /\?commonjs-[a-z-]+$/;
  // Vite's own patterns, on the full id; where Vite 7.3.5 and 8.3.3 differ,
  // the one that leaves less unchecked.
  const CSS = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
  const WORKER_WRAPPER = /(?:\?|&)(?:worker|sharedworker)(?:&|$)/;
  const WORKER_FILE = /(?:\?|&)worker_file&type=\w+(?:&|$)/;
  const RAW_OR_URL = /(?:\?|&)(?:raw|url)(?:&|$)/;
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
    if (KNOWN_VIRTUAL.has(id) || BROWSER_EXTERNAL.test(id)) {
      return { kind: "helper" };
    }
    let file = id;
    if (id.startsWith("\0")) {
      const rest = id.slice(1);
      const wrapped = rest.split("?")[0]!;
      if (!path.isAbsolute(wrapped) || !COMMONJS_WRAPPER.test(rest)) {
        return unverified("is a virtual module Morph does not know");
      }
      file = wrapped;
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

  type Node = { type: string; [key: string]: unknown };
  const isNode = (value: unknown): value is Node =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string";
  /** Every node of a parsed program, depth first. */
  const nodesOf = (root: Node): Node[] => {
    const found: Node[] = [];
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const value = stack.pop();
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      if (!isNode(value)) continue;
      found.push(value);
      for (const [key, child] of Object.entries(value)) {
        if (key !== "type" && typeof child === "object") stack.push(child);
      }
    }
    return found;
  };
  /** `import.meta.url`, dotted or as `import.meta["url"]`. */
  const isImportMetaUrl = (node: unknown): boolean => {
    if (!isNode(node) || node.type !== "MemberExpression") return false;
    const object = node.object as Node;
    const property = node.property as Node;
    const meta =
      isNode(object) &&
      object.type === "MetaProperty" &&
      (object.meta as { name?: string })?.name === "import" &&
      (object.property as { name?: string })?.name === "meta";
    const url = node.computed
      ? isNode(property) &&
        property.type === "Literal" &&
        property.value === "url"
      : isNode(property) && (property as { name?: string }).name === "url";
    return Boolean(meta && url);
  };
  /** A string the code states outright: a literal, or a template with no holes. */
  /**
   * A string the code states outright and spells as it means it: a quoted
   * literal or a template with no holes, whose source has no escape (Vite
   * reads the source spelling, so an escape could name one path to this
   * check and another to Vite).
   */
  const plainString = (node: unknown): string | null => {
    if (!isNode(node)) return null;
    if (node.type === "Literal" && typeof node.value === "string") {
      const raw = typeof node.raw === "string" ? node.raw : null;
      if (raw === null || raw.includes("\\")) return null;
      return raw.slice(1, -1) === node.value ? node.value : null;
    }
    if (
      node.type === "TemplateLiteral" &&
      Array.isArray(node.expressions) &&
      node.expressions.length === 0 &&
      Array.isArray(node.quasis) &&
      node.quasis.length === 1
    ) {
      const value = (
        node.quasis[0] as { value?: { raw?: unknown; cooked?: unknown } }
      ).value;
      if (typeof value?.raw !== "string" || value.raw.includes("\\"))
        return null;
      return value.raw === value.cooked ? value.raw : null;
    }
    return null;
  };
  // A path relative to the module, spelled plainly: no query, fragment,
  // percent-escape, backslash or empty segment, so Vite's own resolution of
  // it (path.resolve from the module, then its file-system resolver) starts
  // from the same path this check does.
  const PLAIN_RELATIVE =
    /^\.\.?\/(?:[A-Za-z0-9_@+~-][A-Za-z0-9_.@+~-]*\/|\.\.?\/)*[A-Za-z0-9_@+~.-]*[A-Za-z0-9_@+~-]$/;
  // What Vite's file-system resolver tries for a path that names no file:
  // its default extensions, then an index file, in that directory.
  const RESOLVE_EXTENSIONS = [
    ".mjs",
    ".js",
    ".mts",
    ".ts",
    ".jsx",
    ".tsx",
    ".json",
  ];
  const isFile = (file: string) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };

  return {
    name: "morph:worker-bundle-guard",
    load: {
      order: "pre" as const,
      handler(this: { error(message: string): never }, id: string) {
        if (CSS.test(id.replace(/^\0/, ""))) {
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
      this: {
        error(message: string): never;
        parse(code: string): unknown;
      },
      code: string,
      id: string,
    ) {
      // Vite's own wrapper for a `?worker` import: the worker's code is
      // bundled, and guarded, as a worker bundle of its own.
      if (WORKER_WRAPPER.test(id) && !WORKER_FILE.test(id)) return null;
      // A file's text or address, not code that runs.
      if (RAW_OR_URL.test(id)) return null;
      if (place(id).kind !== "theme") return null;
      if (!/\bmeta\b/.test(code)) return null;
      const refuse = (why: string): never =>
        this.error(
          'WORKER_ASSET_URL_UNSUPPORTED: Worker module "' +
            id +
            '" ' +
            why +
            ".",
        );
      // Read as a program, not as text: comments, strings and spacing are the
      // parser's business, so no spelling of import.meta.url escapes the check
      // and no text that merely names it is counted.
      let program: unknown;
      try {
        program = this.parse(code);
      } catch {
        return refuse("could not be parsed to check its import.meta.url");
      }
      if (!isNode(program))
        return refuse("could not be parsed to check its import.meta.url");
      const nodes = nodesOf(program);
      const checked = new Set<unknown>();
      const literals: string[] = [];
      for (const node of nodes) {
        if (node.type !== "NewExpression") continue;
        const callee = node.callee as Node;
        if (
          !isNode(callee) ||
          callee.type !== "Identifier" ||
          callee.name !== "URL"
        )
          continue;
        const args = Array.isArray(node.arguments) ? node.arguments : [];
        if (!isImportMetaUrl(args[1])) continue;
        const literal = plainString(args[0]);
        if (literal === null) {
          refuse(
            "passes import.meta.url to new URL() with something other than a plain string",
          );
        }
        checked.add(args[1]);
        literals.push(literal as string);
      }
      // Every import.meta.url is one of those calls: Vite resolves and reads
      // a file only for that shape, and any other use is refused rather than
      // judged.
      for (const node of nodes) {
        if (isImportMetaUrl(node) && !checked.has(node)) {
          refuse(
            'uses import.meta.url other than as new URL("…", import.meta.url) with a plain string',
          );
        }
      }
      const moduleDir = path.dirname(id.split("?")[0]!);
      for (const literal of literals) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(literal) || literal.startsWith("//"))
          continue;
        // Only a plain relative path: for a root-relative or bare one Vite
        // runs its own resolver (aliases, public/, packages), whose answer a
        // build plugin cannot see, so it is refused rather than guessed.
        if (!PLAIN_RELATIVE.test(literal)) {
          refuse(
            'names "' +
              literal +
              '" in new URL(); only a plain relative path (./ or ../, no query) is supported in a worker',
          );
        }
        // Every file Vite's resolver could pick for it: the path itself,
        // its default extensions, and an index file or package.json in it
        // when it is a directory. Each must be the Theme's (or an approved
        // package's); a path that names none is left unread, as Vite leaves
        // it.
        const base = path.resolve(moduleDir, literal);
        const candidates = [
          base,
          ...RESOLVE_EXTENSIONS.map((extension) => base + extension),
          path.join(base, "package.json"),
          ...RESOLVE_EXTENSIONS.map((extension) =>
            path.join(base, "index" + extension),
          ),
        ];
        for (const file of candidates) {
          if (!isFile(file)) continue;
          if (file === path.join(base, "package.json")) {
            refuse(
              'names "' +
                literal +
                '", a directory with a package.json, whose entry Vite would choose',
            );
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
