import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const artifactDir = path.resolve(process.argv[2] ?? "dist/client");
if (!existsSync(artifactDir) || !statSync(artifactDir).isDirectory()) {
  throw new Error(`DEPLOY_ARTIFACT_NOT_FOUND: ${artifactDir}`);
}

const forbiddenNames = new Set([".dev.vars", ".env", ".env.local", "wrangler.json"]);
const secretKey = /\b(?:BETTER_AUTH_SECRET|RESEND_API_KEY|DATABASE_URL)\b/;
const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }
    if (forbiddenNames.has(entry.name)) {
      violations.push(`${path.relative(artifactDir, filePath)}: forbidden secret/config file`);
      continue;
    }
    const contents = readFileSync(filePath, "utf8");
    if (secretKey.test(contents)) {
      violations.push(`${path.relative(artifactDir, filePath)}: embedded secret key`);
    }
  }
}

walk(artifactDir);

const assetsIgnorePath = path.join(artifactDir, ".assetsignore");
if (!existsSync(assetsIgnorePath)) {
  violations.push(".assetsignore: missing deployment exclusion file");
} else {
  const ignored = new Set(
    readFileSync(assetsIgnorePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const required of [".dev.vars", "wrangler.json"]) {
    if (!ignored.has(required)) {
      violations.push(`.assetsignore: missing required exclusion ${required}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `DEPLOY_ARTIFACT_SECRET_GUARD_FAILED:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
}

console.log(`Deploy artifact secret guard passed: ${artifactDir}`);
