/**
 * Whether the SDK in `packages/morph-sdk` can ship as a package of its own.
 *
 * Four things, each a separate finding kind so a failure names its cause:
 *
 * - `config`: the package's own `tsconfig.json` names no `paths`, `baseUrl`
 *   or `extends`. Anything from the app's config would make the standalone
 *   build below depend on the app after all.
 * - `app-alias`, `escapes-package`, `undeclared-dependency`: every module a
 *   shipped file names is the package's own file, or a dependency its
 *   `package.json` declares. A Node built-in counts as undeclared: a browser
 *   bundle cannot have one.
 * - `build`: the package type-checks and emits from its own `tsconfig.json`
 *   alone, with no ambient types.
 * - `bundle`, `bundle-import`, `bundle-load`: Vite bundles the entry for a
 *   browser, a worker (`ssr.target: "webworker"`) and Node. No module may be
 *   loaded from outside the package. A bundle may import nothing but declared
 *   dependencies. The Node bundle is imported and must expose every export
 *   Rollup reports.
 *
 * What the bundles prove: the entry is self-contained source that a standard
 * bundler resolves and emits for those targets without the app's aliases, and
 * the Node output evaluates. What they do not prove: that a Start or Astro app
 * builds with the package, that it runs in a browser or a Worker runtime, or
 * that its requests succeed. Those belong to stage 2.
 *
 * Pure apart from the files it reads and the scratch directory it is given.
 * The CLI is `check-sdk-package.mjs`; the tests are
 * `sdk-package-check.test.mjs`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.(?:[cm]?[jt]sx?)$/;

/** Every module a source names: imports, re-exports, dynamic, `require`, type references. */
export function moduleSpecifiers(source) {
  const info = ts.preProcessFile(source, true, true);
  return [
    ...info.importedFiles.map((entry) => entry.fileName),
    ...info.typeReferenceDirectives.map((entry) => entry.fileName),
  ];
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageNameOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isInside(directory, path) {
  const fromDirectory = relative(directory, path);
  return (
    fromDirectory === "" ||
    (!fromDirectory.startsWith("..") && !isAbsolute(fromDirectory))
  );
}

/**
 * Why one specifier in `file` may not ship, or null when it may.
 *
 * `aliases` are the app's path-alias prefixes (`@/`, ...): read from the
 * app's config by the CLI, so a new alias there is refused here too.
 */
export function classifySpecifier(specifier, file, context) {
  const { packageDir, declared, ownName, aliases } = context;
  if (aliases.some((alias) => specifier.startsWith(alias))) {
    return { kind: "app-alias", detail: specifier };
  }
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const target = resolve(dirname(file), specifier);
    return isInside(packageDir, target)
      ? null
      : { kind: "escapes-package", detail: specifier };
  }
  if (isBuiltin(specifier)) {
    return {
      kind: "undeclared-dependency",
      detail: `${specifier} (Node built-in)`,
    };
  }
  const name = packageNameOf(specifier);
  if (name === ownName || declared.has(name)) return null;
  return { kind: "undeclared-dependency", detail: specifier };
}

function shippedFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return shippedFiles(path);
    return CODE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });
}

function readManifest(packageDir) {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  );
  const declared = new Set(
    ["dependencies", "peerDependencies", "optionalDependencies"].flatMap(
      (field) => Object.keys(manifest[field] ?? {}),
    ),
  );
  const root = manifest.exports?.["."] ?? manifest.exports ?? manifest.main;
  const entry =
    typeof root === "string" ? root : (root?.import ?? root?.default ?? null);
  return { name: manifest.name, declared, entry };
}

function formatDiagnostic(diagnostic, packageDir) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return `${relative(packageDir, diagnostic.file.fileName)}:${line + 1} ${message}`;
}

/** The standalone compile: the package's own config, nothing else. */
function compile(packageDir, scratch, findings) {
  const configPath = join(packageDir, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    findings.push({
      kind: "config",
      detail: formatDiagnostic(read.error, packageDir),
    });
    return;
  }
  const raw = read.config;
  if (raw.extends !== undefined) {
    findings.push({ kind: "config", detail: 'tsconfig.json sets "extends"' });
  }
  for (const key of ["paths", "baseUrl"]) {
    if (raw.compilerOptions?.[key] !== undefined) {
      findings.push({
        kind: "config",
        detail: `tsconfig.json sets compilerOptions.${key}`,
      });
    }
  }
  const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, packageDir);
  for (const error of parsed.errors) {
    findings.push({
      kind: "config",
      detail: formatDiagnostic(error, packageDir),
    });
  }
  for (const file of parsed.fileNames) {
    if (!isInside(packageDir, file)) {
      findings.push({
        kind: "config",
        detail: `compiles ${file}, outside the package`,
      });
    }
  }
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    noEmit: false,
    outDir: join(scratch, "tsc"),
    declarationDir: join(scratch, "tsc"),
  });
  // Emitted to nowhere: only its diagnostics are wanted. Written to disk, a
  // file pulled in from outside `rootDir` lands beside its own source, which
  // for an escaping import is inside the app's `src/`.
  const emitted = program.emit(undefined, () => {});
  for (const diagnostic of [
    ...ts.getPreEmitDiagnostics(program),
    ...emitted.diagnostics,
  ]) {
    findings.push({
      kind: "build",
      detail: formatDiagnostic(diagnostic, packageDir),
    });
  }
  return parsed.fileNames.length;
}

const TARGETS = ["browser", "worker", "node"];

/** One Vite build of the entry for `target`, refusing any module outside the package. */
async function bundle(target, context, scratch, findings) {
  const { build } = await import("vite");
  const { packageDir, declared, entry } = context;
  const external = (id) =>
    !id.startsWith(".") &&
    !isAbsolute(id) &&
    !id.startsWith("\0") &&
    declared.has(packageNameOf(id));
  const boundary = {
    name: "morph-sdk-package-boundary",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || external(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved || resolved.external || resolved.id.startsWith("\0")) {
        return resolved;
      }
      const path = resolved.id.split("?")[0];
      if (!isInside(packageDir, path)) {
        this.error(
          `${relative(packageDir, importer)} loads ${source}, which resolves outside the package`,
        );
      }
      return resolved;
    },
  };
  const outDir = join(scratch, target);
  const config = {
    configFile: false,
    root: packageDir,
    logLevel: "silent",
    publicDir: false,
    plugins: [boundary],
    build: {
      outDir,
      emptyOutDir: true,
      write: target === "node",
      minify: false,
      sourcemap: false,
      target: "es2022",
      copyPublicDir: false,
      reportCompressedSize: false,
      rollupOptions: { external, output: { format: "es" } },
      ...(target === "browser"
        ? { lib: { entry, formats: ["es"], fileName: "index" } }
        : { ssr: entry }),
    },
    ...(target === "browser"
      ? {}
      : {
          ssr: {
            target: target === "worker" ? "webworker" : "node",
            noExternal: true,
          },
        }),
  };
  let result;
  try {
    result = await build(config);
  } catch (error) {
    findings.push({
      kind: "bundle",
      detail: `${target}: ${String(error?.message ?? error).split("\n")[0]}`,
    });
    return null;
  }
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (each) => each.output,
  );
  const chunks = outputs.filter((item) => item.type === "chunk");
  const own = new Set(outputs.map((item) => item.fileName));
  let bytes = 0;
  for (const chunk of chunks) {
    bytes += Buffer.byteLength(chunk.code);
    for (const imported of [...chunk.imports, ...chunk.dynamicImports]) {
      if (own.has(imported) || declared.has(packageNameOf(imported))) continue;
      findings.push({
        kind: "bundle-import",
        detail: `${target}: ${chunk.fileName} imports ${imported}`,
      });
    }
  }
  const main = chunks.find((chunk) => chunk.isEntry);
  if (!main || main.exports.length === 0) {
    findings.push({ kind: "bundle", detail: `${target}: no entry exports` });
    return { target, bytes };
  }
  if (target === "node") {
    try {
      const loaded = await import(
        pathToFileURL(join(outDir, main.fileName)).href
      );
      const missing = main.exports.filter((name) => loaded[name] === undefined);
      if (missing.length > 0) {
        findings.push({
          kind: "bundle-load",
          detail: `node: ${missing.join(", ")} undefined after import`,
        });
      }
    } catch (error) {
      findings.push({
        kind: "bundle-load",
        detail: `node: ${String(error?.message ?? error).split("\n")[0]}`,
      });
    }
  }
  return { target, bytes, exports: main.exports.length };
}

/**
 * Runs every check on the package in `packageDir`, writing only under
 * `scratch`. Resolves to the findings (empty when it may ship) and what was
 * checked.
 */
export async function checkSdkPackage(
  packageDir,
  { scratch, aliases = ["@/"] },
) {
  const findings = [];
  const manifest = readManifest(packageDir);
  const context = {
    packageDir,
    declared: manifest.declared,
    ownName: manifest.name,
    aliases,
    entry: manifest.entry ? resolve(packageDir, manifest.entry) : null,
  };
  if (!context.entry || !statSync(context.entry, { throwIfNoEntry: false })) {
    findings.push({
      kind: "config",
      detail: `package.json names no entry file that exists (${manifest.entry})`,
    });
  }

  const files = shippedFiles(packageDir);
  let specifierCount = 0;
  for (const file of files) {
    for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
      specifierCount += 1;
      const refused = classifySpecifier(specifier, file, context);
      if (refused) {
        findings.push({
          ...refused,
          detail: `${relative(packageDir, file)} -> ${refused.detail}`,
        });
      }
    }
  }

  const compiled = compile(packageDir, scratch, findings) ?? 0;

  const bundles = [];
  if (context.entry && statSync(context.entry, { throwIfNoEntry: false })) {
    for (const target of TARGETS) {
      const built = await bundle(target, context, scratch, findings);
      if (built) bundles.push(built);
    }
  }

  return {
    findings,
    checked: {
      name: manifest.name,
      files: files.length,
      specifiers: specifierCount,
      compiled,
      bundles,
    },
  };
}
