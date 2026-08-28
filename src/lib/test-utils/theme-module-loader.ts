import { transformSync } from "esbuild";
import { createRequire } from "node:module";
import * as jsxRuntime from "react/jsx-runtime";

import { DEFAULT_APPROVED_DEPENDENCIES } from "@/lib/storefront/compiler/sandbox-vite-theme-build-runner.types";

export type ThemeSourceFile = { path: string; content: string };

/** Attributes the editor injects for its own use; the build never emits them. */
const EDITOR_ATTRIBUTE = /\s(?:data-(?:morph|storefront|tsd)-[a-z-]+)="[^"]*"/g;

/**
 * Reduces rendered markup to what both paths are expected to agree on.
 *
 * Editor annotations exist only in the preview, and head output is the router's
 * job — Live Preview renders into an existing document and has no head to write
 * to. Everything else is compared literally.
 */
export function normalizeThemeMarkup(html: string): string {
  return html
    .replace(/<link[^>]*>|<meta[^>]*>|<title>[\s\S]*?<\/title>/g, "")
    .replace(EDITOR_ATTRIBUTE, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Loads Theme modules the way the build does, compiled in process.
 *
 * A temp directory and a real bundler would answer the same question but with
 * filesystem and cache state of their own, and a parity check has to be able to
 * blame the interpreter rather than the harness.
 */
export function createThemeModuleLoader(files: readonly ThemeSourceFile[]) {
  const hostRequire = createRequire(import.meta.url);
  const approved = new Set(DEFAULT_APPROVED_DEPENDENCIES);
  const cache = new Map<string, Record<string, unknown>>();
  const preloaded = new Map<string, unknown>();

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
