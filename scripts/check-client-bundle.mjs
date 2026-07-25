#!/usr/bin/env node
/**
 * Fails the build if server-only values reached the client bundle.
 *
 * The secrets in `src/cms.config.ts` are kept out of the browser by the
 * TanStack Start compiler, which replaces the body of `createServerOnlyFn`.
 * That is a transform, not a structural boundary: hoisting `process.env` above
 * the function, re-exporting it, or a regression in the compiler all break the
 * protection silently, with `tsc` and `vite build` still passing.
 *
 * This scans the built client assets instead of the source, which is the only
 * place the failure is observable.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const clientDir = join(projectRoot, "dist", "client");

/**
 * Server-only environment variable names, mirroring `.env.example` minus the
 * values that are meant to be public (`PUBLIC_URL`).
 */
const FORBIDDEN_NAMES = [
  "RESEND_API_KEY",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "CLOUDFLARE_D1_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_DATABASE_ID",
  "connectionString",
];

/** Credential shapes worth catching even if the variable was renamed. */
const FORBIDDEN_PATTERNS = [
  { label: "Resend API key", regex: /\bre_[A-Za-z0-9_-]{16,}/ },
  { label: "Stripe live key", regex: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { label: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
];

const collectFiles = (dir) => {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? collectFiles(full) : [full];
  });
};

let files;
try {
  files = collectFiles(clientDir);
} catch {
  console.error(
    `\n[check-client-bundle] dist/client not found at ${clientDir}.\n` +
      `Run this after \`vite build\`.\n`,
  );
  process.exit(1);
}

const findings = [];

for (const file of files) {
  // Source maps mirror the original module text, so a hit there is expected
  // noise rather than a leak in shipped code.
  if (file.endsWith(".map")) continue;

  const content = readFileSync(file, "utf8");
  const rel = relative(projectRoot, file);

  for (const name of FORBIDDEN_NAMES) {
    if (content.includes(name)) {
      findings.push({ file: rel, hit: name });
    }
  }
  for (const { label, regex } of FORBIDDEN_PATTERNS) {
    const match = content.match(regex);
    if (match) {
      findings.push({ file: rel, hit: `${label} (${match[0].slice(0, 12)}…)` });
    }
  }
}

if (findings.length > 0) {
  console.error("\n[check-client-bundle] Server-only values found in the client bundle:\n");
  for (const { file, hit } of findings) {
    console.error(`  ${file}\n    → ${hit}`);
  }
  console.error(
    "\nMove the value into `cmsConfig.server`, and read `process.env` inside\n" +
      "that `createServerOnlyFn` callback rather than at module scope.\n",
  );
  process.exit(1);
}

console.log(
  `[check-client-bundle] OK — scanned ${files.length} files, no server-only values found.`,
);
