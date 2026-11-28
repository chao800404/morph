import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startPreviewFilesForShard } from "./editor-e2e-start.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shard = Number(process.argv[2]);
  const files = startPreviewFilesForShard(shard);
  // The Node runner itself, as `pnpm test:e2e:local-preview` would start it:
  // pnpm signals its own lifecycle shell on cancel, and the signal then never
  // reached the runner.
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./run-editor-e2e.mjs", import.meta.url)),
      ...files.map((file) => `e2e/${file}`),
    ],
    { stdio: "inherit" },
  );
  // GitHub cancels a step with SIGINT, then SIGTERM, then a kill of the tree.
  // The launcher used to wait in spawnSync, which never saw those signals, so
  // the runner's teardown (and its log copy) only began when the tree was
  // killed. The same signal is passed on to the runner; nothing else is
  // signalled and nothing is escalated here.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        // The child may have exited while the signal arrived.
      }
    });
  }
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  child.on("close", (code, signal) => {
    process.exit(
      code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1),
    );
  });
}
