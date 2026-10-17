/**
 * Refuses an SDK that could not ship as a package of its own.
 *
 * The rules live in `sdk-package-check.mjs` and are tested by
 * `sdk-package-check.test.mjs`. This file only decides which package to check
 * and what to say. The app's path aliases are read from its own
 * `tsconfig.json`, so an alias added there is refused in the SDK as well.
 *
 * The app does not import the SDK; stage 2 decides that (#245 §7).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { checkSdkPackage } from "./sdk-package-check.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(projectRoot, "packages", "morph-sdk");

const appConfig = ts.readConfigFile(
  join(projectRoot, "tsconfig.json"),
  ts.sys.readFile,
);
if (appConfig.error) {
  console.error("[check-sdk-package] could not read the app's tsconfig.json");
  process.exit(1);
}
const aliases = Object.keys(appConfig.config.compilerOptions?.paths ?? {}).map(
  (pattern) => pattern.replace(/\*$/, ""),
);

const scratch = mkdtempSync(join(tmpdir(), "morph-sdk-check-"));
try {
  const { findings, checked } = await checkSdkPackage(packageDir, {
    scratch,
    aliases,
  });
  if (findings.length > 0) {
    console.error(
      `[check-sdk-package] ${checked.name} cannot ship as its own package:`,
    );
    for (const finding of findings) {
      console.error(`  ${finding.kind}: ${finding.detail}`);
    }
    process.exitCode = 1;
  } else {
    const bundles = checked.bundles
      .map((each) => `${each.target} ${each.bytes} B`)
      .join(", ");
    console.log(
      `[check-sdk-package] OK — ${checked.name}: ${checked.files} files, ${checked.specifiers} imports, all inside the package; compiled ${checked.compiled} files on its own config; bundled for ${bundles}.`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
