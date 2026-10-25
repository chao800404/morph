import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startPreviewFilesForShard } from "./editor-e2e-start.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shard = Number(process.argv[2]);
  const files = startPreviewFilesForShard(shard);
  const result = spawnSync(
    "pnpm",
    ["test:e2e:local-preview", "--", ...files.map((file) => `e2e/${file}`)],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
