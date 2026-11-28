import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The private, verified copy Wrangler deploys from (design 2, round 5/6).
 *
 * Wrangler must read nothing from the checkout: not the config, not the
 * Worker bundle, not the container image inputs. So the snapshot holds every
 * path the built config references, at the same root-relative place:
 *
 * - the build output (`dist/`: the Worker, its assets, the config itself);
 * - the D1 `migrations_dir`;
 * - each container's Dockerfile, and every file its `COPY`/`ADD` instructions
 *   take from the build context.
 *
 * The config written into the snapshot is the checked artifact with exactly
 * one change: container `image` and `image_build_context` paths, which the
 * Vite plugin writes as absolute checkout paths, are moved to the same
 * root-relative place in the snapshot. Anything the snapshot cannot hold
 * faithfully — a referenced path outside the checkout, a Dockerfile source
 * with a wildcard, a remote `ADD`, a source outside the build context — is a
 * refusal, not a copy of something else.
 */

export class SnapshotRefusal extends Error {
  override readonly name = "SnapshotRefusal";
}

export type Snapshot = Readonly<{
  dir: string;
  /** `<dir>/dist/server/wrangler.json`. */
  configPath: string;
  /** What was written there: the checked artifact with container paths moved into the snapshot. */
  configText: string;
  /** Every root-relative path copied (files and directories). */
  copied: readonly string[];
}>;

type Json = Record<string, unknown>;

function inside(root: string, file: string, what: string): string {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new SnapshotRefusal(`${what} (${file}) is not inside the checkout ${root}; the snapshot cannot hold it.`);
  }
  return rel;
}

/** A container `image` that is a Dockerfile path, not a registry reference. */
function isDockerfilePath(image: string): boolean {
  return image.startsWith("/") || image.startsWith("./") || image.startsWith("../") || /dockerfile/i.test(path.basename(image));
}

/**
 * The context paths a Dockerfile copies in. Only plain sources are accepted:
 * `COPY --from=` reads another stage or image (not the context) and is
 * skipped; a wildcard, a remote URL or a path leaving the context is refused.
 */
export function dockerfileSources(dockerfile: string): string[] {
  const lines = dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  const sources: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const match = /^(COPY|ADD)\s+(.*)$/i.exec(line);
    if (!match) continue;
    const instruction = match[1]!.toUpperCase();
    let rest = match[2]!.trim();
    let args: string[];
    const flags: string[] = [];
    while (rest.startsWith("--")) {
      const space = rest.search(/\s/);
      flags.push(space < 0 ? rest : rest.slice(0, space));
      rest = space < 0 ? "" : rest.slice(space).trim();
    }
    if (flags.some((flag) => flag.startsWith("--from="))) continue;
    if (rest.startsWith("[")) {
      try {
        args = JSON.parse(rest) as string[];
      } catch {
        throw new SnapshotRefusal(`Dockerfile: cannot parse "${line}".`);
      }
    } else {
      args = rest.split(/\s+/).filter(Boolean);
    }
    if (args.length < 2) throw new SnapshotRefusal(`Dockerfile: "${line}" has no source.`);
    for (const source of args.slice(0, -1)) {
      if (/[*?[\]]/.test(source)) throw new SnapshotRefusal(`Dockerfile: "${line}" uses a wildcard source; list the files.`);
      if (instruction === "ADD" && /^[a-z]+:\/\//i.test(source)) {
        throw new SnapshotRefusal(`Dockerfile: "${line}" adds a remote URL; the snapshot cannot verify it.`);
      }
      const normalized = path.posix.normalize(source);
      if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
        throw new SnapshotRefusal(`Dockerfile: "${line}" copies from outside the build context.`);
      }
      sources.push(normalized);
    }
  }
  return sources;
}

export function createSnapshot(input: {
  root: string;
  /** `<root>/dist/server/wrangler.json`. */
  artifactPath: string;
  /** The artifact text the guard checked. */
  artifactText: string;
  /** Where to create the private directory (default: the OS temp dir). */
  parent?: string;
}): Snapshot {
  const root = path.resolve(input.root);
  const artifactDir = path.dirname(input.artifactPath);
  const artifactRel = inside(root, input.artifactPath, "The artifact");
  const config = JSON.parse(input.artifactText) as Json;
  const copies = new Set<string>(["dist"]);
  if (!artifactRel.startsWith(`dist${path.sep}`)) throw new SnapshotRefusal(`The artifact is not under dist/.`);

  // Paths the config resolves relative to its own directory must stay in dist/.
  const main = typeof config.main === "string" ? config.main : null;
  if (main) inside(path.join(root, "dist"), path.resolve(artifactDir, main), "main");
  const assets = config.assets as Json | undefined;
  if (assets && typeof assets.directory === "string") {
    inside(path.join(root, "dist"), path.resolve(artifactDir, assets.directory), "assets.directory");
  }

  for (const database of (config.d1_databases as Json[] | undefined) ?? []) {
    if (typeof database.migrations_dir === "string") {
      copies.add(inside(root, path.resolve(artifactDir, database.migrations_dir), "migrations_dir"));
    }
  }

  const containers = (config.containers as Json[] | undefined) ?? [];
  const moved: Array<{ index: number; image?: string; context?: string }> = [];
  containers.forEach((container, index) => {
    const image = container.image;
    if (typeof image !== "string" || !isDockerfilePath(image)) return; // a registry image: nothing to copy
    const dockerfile = path.resolve(artifactDir, image);
    const dockerfileRel = inside(root, dockerfile, `containers[${index}].image`);
    const contextRaw = typeof container.image_build_context === "string" ? container.image_build_context : path.dirname(image);
    const context = path.resolve(artifactDir, contextRaw);
    const contextRel = path.relative(root, context);
    if (contextRel.startsWith("..") || path.isAbsolute(contextRel)) {
      throw new SnapshotRefusal(`containers[${index}].image_build_context (${context}) is not inside the checkout.`);
    }
    if (!existsSync(dockerfile)) throw new SnapshotRefusal(`containers[${index}].image: ${dockerfile} does not exist.`);
    copies.add(dockerfileRel);
    for (const source of dockerfileSources(readFileSync(dockerfile, "utf8"))) {
      const file = path.join(context, source);
      const rel = inside(root, file, `a COPY source of ${dockerfileRel}`);
      if (!existsSync(file)) throw new SnapshotRefusal(`${dockerfileRel} copies ${source}, which does not exist.`);
      copies.add(rel);
    }
    moved.push({ index, image: dockerfileRel, context: contextRel });
  });

  const dir = mkdtempSync(path.join(input.parent ?? tmpdir(), "morph-core-deploy-"));
  chmodSync(dir, 0o700);
  // Longest paths last never matters for cpSync; sorted so the copy is deterministic.
  for (const rel of [...copies].sort()) {
    const from = path.join(root, rel);
    const to = path.join(dir, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    if (existsSync(to) && statSync(to).isDirectory() && statSync(from).isDirectory()) continue;
    cpSync(from, to, { recursive: true, dereference: true, force: false, errorOnExist: false });
  }

  for (const { index, image, context } of moved) {
    const container = containers[index]!;
    container.image = path.join(dir, image!);
    container.image_build_context = context ? path.join(dir, context) : dir;
  }
  const configText = moved.length > 0 ? JSON.stringify(config) : input.artifactText;
  const configPath = path.join(dir, artifactRel);
  writeFileSync(configPath, configText);
  return { dir, configPath, configText, copied: [...copies].sort() };
}

/**
 * The checked artifact as the snapshot must hold it: identical, except that
 * container paths point into `dir`. The runner compares the snapshot's config
 * with this, byte for byte.
 */
export function expectedSnapshotConfig(artifactText: string, root: string, artifactPath: string, dir: string): string {
  const config = JSON.parse(artifactText) as Json;
  const containers = (config.containers as Json[] | undefined) ?? [];
  let moved = false;
  for (const container of containers) {
    if (typeof container.image !== "string" || !isDockerfilePath(container.image)) continue;
    const artifactDir = path.dirname(artifactPath);
    const image = path.resolve(artifactDir, container.image);
    const contextRaw = typeof container.image_build_context === "string" ? container.image_build_context : path.dirname(container.image);
    const context = path.resolve(artifactDir, contextRaw);
    container.image = path.join(dir, path.relative(root, image));
    const contextRel = path.relative(root, context);
    container.image_build_context = contextRel ? path.join(dir, contextRel) : dir;
    moved = true;
  }
  return moved ? JSON.stringify(config) : artifactText;
}

/** Every path Wrangler's normalized config resolves must be inside the snapshot. */
export function pathsOutsideSnapshot(normalized: unknown, dir: string, configPath: string): string[] {
  const config = (normalized ?? {}) as Json;
  const configDir = path.dirname(configPath);
  const out: string[] = [];
  const check = (label: string, value: unknown) => {
    if (typeof value !== "string" || value === "") return;
    const resolved = path.resolve(configDir, value);
    const rel = path.relative(dir, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) out.push(`${label} resolves to ${resolved}, outside the snapshot ${dir}`);
  };
  check("main", config.main);
  check("assets.directory", (config.assets as Json | undefined)?.directory);
  for (const [index, database] of ((config.d1_databases as Json[] | undefined) ?? []).entries()) {
    check(`d1_databases[${index}].migrations_dir`, database.migrations_dir);
  }
  for (const [index, container] of ((config.containers as Json[] | undefined) ?? []).entries()) {
    if (typeof container.image === "string" && isDockerfilePath(container.image)) {
      check(`containers[${index}].image`, container.image);
      check(`containers[${index}].image_build_context`, container.image_build_context);
    }
  }
  return out;
}
