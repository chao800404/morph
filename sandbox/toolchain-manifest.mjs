#!/usr/bin/env node
/**
 * Writes a toolchain's manifest and identity, inside the Sandbox image, right
 * after `npm ci` installed it. Run as:
 *
 *   node toolchain-manifest.mjs <framework> <toolchain root>
 *
 * The manifest says what this image installed at that root: the exact
 * package.json and lockfile, every installed position with its dependency
 * relations and platform limits, and the Node, npm, base image and platform it
 * was installed with. Its identity is the SHA-256 of its canonical bytes.
 *
 * What it proves, and what it does not: a build compares the manifest it reads
 * in its container, before any Theme code runs, with the identity its record
 * names. That is a compatibility and provenance check: the toolchain the
 * container declares is the one expected. It is not tamper evidence. Processes
 * in the container run as root, so code that runs after the check can still
 * change the installed files.
 *
 * Canonical form (manifestFormat 1):
 * - JSON with object keys sorted by code point at every level, no whitespace,
 *   UTF-8; the identity is the SHA-256 of exactly those bytes;
 * - installed positions are the keys of npm's own record of what it installed
 *   (node_modules/.package-lock.json), as POSIX paths relative to the root,
 *   sorted;
 * - every listed field is present; a field the record lacks is `null`, never
 *   omitted and never an empty string;
 * - nothing machine- or time-dependent: no timestamps, no absolute paths.
 * A change to these rules is a new manifestFormat, never a silent change.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MANIFEST_FORMAT = 1;
const POSITION_FIELDS = [
  "name",
  "version",
  "resolved",
  "integrity",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optional",
  "engines",
  "os",
  "cpu",
  "libc",
  "hasInstallScript",
];

const [framework, rootArg] = process.argv.slice(2);
if (!framework || !rootArg) {
  console.error("usage: toolchain-manifest.mjs <framework> <toolchain root>");
  process.exit(2);
}
const root = path.resolve(rootArg);
const baseImage = process.env.MORPH_SANDBOX_BASE_IMAGE;
if (!baseImage || !/@sha256:[0-9a-f]{64}$/.test(baseImage)) {
  console.error(
    "MORPH_SANDBOX_BASE_IMAGE must name the base image by digest (…@sha256:<64 hex>).",
  );
  process.exit(2);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const packageJsonBytes = readFileSync(path.join(root, "package.json"));
const lockBytes = readFileSync(path.join(root, "package-lock.json"));
const installedRecord = JSON.parse(
  readFileSync(path.join(root, "node_modules", ".package-lock.json"), "utf8"),
);
const positions = Object.keys(installedRecord.packages)
  .filter((key) => key !== "")
  .sort()
  .map((key) => {
    const entry = installedRecord.packages[key];
    const position = { path: key };
    for (const field of POSITION_FIELDS) {
      position[field] =
        field === "name"
          ? (entry.name ?? key.split("node_modules/").pop())
          : (entry[field] ?? null);
    }
    return position;
  });

const report = process.report.getReport();
const glibc = report.header.glibcVersionRuntime;
const manifest = {
  manifestFormat: MANIFEST_FORMAT,
  framework,
  root: path.basename(root),
  packageJson: JSON.parse(packageJsonBytes.toString("utf8")),
  packageJsonSha256: sha256(packageJsonBytes),
  packageLockSha256: sha256(lockBytes),
  installed: positions,
  node: process.version,
  npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  baseImage,
  platform: {
    os: process.platform,
    arch: process.arch,
    libc: glibc ? `glibc ${glibc}` : "non-glibc",
  },
};

const bytes = Buffer.from(canonical(manifest), "utf8");
const identity = sha256(bytes);
writeFileSync(path.join(root, "toolchain.manifest.json"), bytes);
writeFileSync(path.join(root, "toolchain.id"), `${identity}\n`);
console.log(
  `${framework} toolchain at ${root}: ${positions.length} installed positions, identity ${identity}`,
);
