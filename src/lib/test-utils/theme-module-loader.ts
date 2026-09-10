import { transformSync } from "esbuild";
import { createRequire } from "node:module";
import * as jsxRuntime from "react/jsx-runtime";

import { DEFAULT_APPROVED_DEPENDENCIES } from "@/lib/storefront/compiler/sandbox-vite-theme-build-runner.types";

export type ThemeSourceFile = { path: string; content: string };

/** Attributes the editor injects for its own use; the build never emits them. */
const EDITOR_ATTRIBUTE = /\s(?:data-(?:morph|storefront|tsd)-[a-z-]+)="[^"]*"/g;

/** One tag's attributes, in the order they were written. */
const TAG_WITH_ATTRIBUTES =
  /<([a-zA-Z][^\s/>]*)((?:\s+[^\s=/>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)+)(\s*\/?)>/g;
const ATTRIBUTE = /[^\s=/>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

/**
 * Orders each tag's attributes so two renderers can be compared by meaning.
 *
 * Attribute order carries nothing in HTML, and the two paths have no reason to
 * agree on it: a component that computes an attribute and then spreads the
 * rest emits them in one order, and one that spreads first emits the other.
 * Comparing the text literally reported that as a divergence — a real
 * difference would have looked exactly the same, so the check was reporting
 * noise at the precise place it was meant to be trusted.
 */
function withSortedAttributes(html: string): string {
  return html.replace(
    TAG_WITH_ATTRIBUTES,
    (whole, tag: string, attributes: string, tail: string) => {
      const parts = attributes.match(ATTRIBUTE);
      if (!parts) return whole;
      return `<${tag} ${[...parts].sort().join(" ")}${tail}>`;
    },
  );
}

/**
 * Reduces rendered markup to what both paths are expected to agree on.
 *
 * Editor annotations exist only in the preview, and head output is the router's
 * job — Live Preview renders into an existing document and has no head to write
 * to. Everything else is compared literally.
 */
export function normalizeThemeMarkup(html: string): string {
  return withSortedAttributes(
    html
      .replace(/<link[^>]*>|<meta[^>]*>|<title>[\s\S]*?<\/title>/g, "")
      .replace(EDITOR_ATTRIBUTE, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Loads Theme modules the way the build does, compiled in process.
 *
 * A temp directory and a real bundler would answer the same question but with
 * filesystem and cache state of their own, and a parity check has to be able to
 * blame the interpreter rather than the harness.
 */
export function createThemeModuleLoader(
  files: readonly ThemeSourceFile[],
  options?: {
    /**
     * Packages the harness hands over rather than resolving itself.
     *
     * Resolving a package independently produces a second copy of it, and a
     * library whose API is React context — the router is — then hands the
     * Theme a context the harness's own provider never fills. `<Link>` read a
     * null router and threw, so a component using one could not be compared at
     * all. Passing the harness's own instance in makes them the same module by
     * construction rather than by hoping two resolutions agree.
     */
    packages?: Readonly<Record<string, unknown>>;
  },
) {
  const hostRequire = createRequire(import.meta.url);
  const approved = new Set(DEFAULT_APPROVED_DEPENDENCIES);
  const cache = new Map<string, Record<string, unknown>>();
  const preloaded = new Map<string, unknown>(
    Object.entries(options?.packages ?? {}),
  );

  /** Imports ESM-only approved packages so the loader can hand them over. */
  async function preloadPackages(ids: readonly string[]) {
    for (const id of ids) {
      if (!preloaded.has(id)) {
        preloaded.set(id, await import(/* @vite-ignore */ id));
      }
    }
  }

  function resolveRelative(from: string, specifier: string) {
    const segments = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === ".") continue;
      else if (part === "..") segments.pop();
      else segments.push(part);
    }
    const base = segments.join("/");
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`]) {
      if (files.some((file) => file.path === candidate)) return candidate;
    }
    return `${base}.tsx`;
  }

  function loadModule(sourcePath: string): Record<string, unknown> {
    const hit = cache.get(sourcePath);
    if (hit) return hit;

    const source = files.find((file) => file.path === sourcePath);
    if (!source) throw new Error(`${sourcePath} is not part of this Theme`);
    // A stylesheet contributes nothing to markup and the build resolves it
    // through Tailwind rather than through this module graph.
    if (sourcePath.endsWith(".css")) {
      const empty = {};
      cache.set(sourcePath, empty);
      return empty;
    }

    const { code } = transformSync(source.content, {
      loader: sourcePath.endsWith(".ts") ? "ts" : "tsx",
      jsx: "automatic",
      format: "cjs",
      target: "es2022",
    });

    const module = { exports: {} as Record<string, unknown> };
    cache.set(sourcePath, module.exports);
    const require = (id: string) => {
      if (id.endsWith(".css")) return {};
      if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime") {
        return jsxRuntime;
      }
      if (id.startsWith(".")) return loadModule(resolveRelative(sourcePath, id));
      const ready = preloaded.get(id);
      if (ready) return ready;
      // Approved packages resolve for real, exactly as the build resolves them:
      // a Theme may only import from that list, so anything else reaching here
      // is a package the build would have rejected too.
      if (approved.has(id)) return hostRequire(id);
      throw new Error(
        `${sourcePath} imports ${id}, which the build does not approve`,
      );
    };
    new Function("exports", "module", "require", code)(
      module.exports,
      module,
      require,
    );
    cache.set(sourcePath, module.exports);
    return module.exports;
  }

  return { loadModule, preloadPackages };
}
