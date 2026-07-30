import { readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

/**
 * Static import graph of the source tree, for the checks that guard it.
 *
 * Two properties matter and neither is visible in a type error:
 *
 * 1. **No cycles.** A cycle survives a cold start whenever the entry order
 *    happens to work, then breaks on an HMR reload with
 *    `Cannot access 'X' before initialization` — the dev server has to be
 *    restarted, and the file named in the error is rarely the one at fault.
 * 2. **`cms.config` must not reach a server function.** Config is evaluated on
 *    both sides; dragging the server graph into it is how the cycles above got
 *    created in the first place.
 *
 * Dynamic `import()` is deliberately not followed: deferring a module is the
 * fix, so counting it as an edge would report the fix as the problem.
 */

const ALIASES: Array<[string, string]> = [
  ["@/", "src/"],
  ["@views/", "src/routes/_backend/dashboard/-views/"],
  ["@queries/", "src/routes/_backend/dashboard/-queries/"],
];

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

// Value imports only. `import type` is erased before it can be an edge.
const IMPORT =
  /^\s*import\s+(?!type\b)([\s\S]*?)\bfrom\s+["']([^"']+)["']/gm;
const EXPORT_FROM =
  /^\s*export\s+(?!type\b)(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/gm;
const TYPE_ONLY_CLAUSE = /^\s*\{\s*type\s[\s\S]*\}\s*$/;

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const toPosix = (path: string) => path.split("\\").join("/");

const resolveSpecifier = (
  root: string,
  specifier: string,
  fromFile: string,
): string | null => {
  let base: string;
  if (specifier.startsWith(".")) {
    base = resolve(root, dirname(fromFile), specifier);
  } else {
    const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
    if (!alias) return null;
    base = resolve(root, specifier.replace(alias[0], alias[1]));
  }

  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (isFile(candidate)) return toPosix(relative(root, candidate));
  }
  return null;
};

export const importsOf = (root: string, file: string): string[] => {
  const source = readFileSync(join(root, file), "utf8");
  const specifiers: string[] = [];

  for (const match of source.matchAll(IMPORT)) {
    if (TYPE_ONLY_CLAUSE.test(match[1])) continue;
    specifiers.push(match[2]);
  }
  for (const match of source.matchAll(EXPORT_FROM)) {
    specifiers.push(match[1]);
  }

  return specifiers
    .map((specifier) => resolveSpecifier(root, specifier, file))
    .filter((resolved): resolved is string => resolved !== null);
};

/** Every import cycle reachable from `entries`, as the chain that closes it. */
export const findCycles = (root: string, entries: string[]): string[][] => {
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const walk = (file: string) => {
    state.set(file, "visiting");
    stack.push(file);

    for (const next of importsOf(root, file)) {
      if (state.get(next) === "visiting") {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (!state.has(next)) {
        walk(next);
      }
    }

    stack.pop();
    state.set(file, "done");
  };

  for (const entry of entries) {
    if (!state.has(entry)) walk(entry);
  }

  // One cycle can be reached by several paths; report each set of files once.
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = [...new Set(cycle)].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Import chains from `entry` to any server function or middleware module. */
export const findServerReach = (root: string, entry: string): string[][] => {
  const isServerModule = (file: string) =>
    file.includes(".serverFn.") || file.includes("/middleware/");

  const parents = new Map<string, string>();
  const seen = new Set<string>([entry]);
  const queue = [entry];
  const chains: string[][] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    if (isServerModule(current)) {
      const chain = [current];
      let node = current;
      while (parents.has(node)) {
        node = parents.get(node) as string;
        chain.unshift(node);
      }
      chains.push(chain);
      continue;
    }

    for (const next of importsOf(root, current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      parents.set(next, current);
      queue.push(next);
    }
  }

  return chains;
};

export const formatChain = (chain: string[]) =>
  chain.map((file) => posix.basename(file)).join(" -> ");
