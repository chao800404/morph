import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { env } from "cloudflare:workers";
import { getPlatformProxy } from "wrangler";

/**
 * A fresh local D1 (Miniflare) with every migration under `drizzle/`
 * applied, set as the `env.DATABASE` the application's DAL reads, the way
 * `src/lib/db/d1-batch.integration.test.ts` and `starter-workspace-d1.ts`
 * open theirs. Lives in its own temporary directory; `dispose` removes it.
 */
export async function openMigratedD1(name: string): Promise<{
  d1: D1Database;
  dispose: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name,
      compatibility_date: "2025-09-02",
      d1_databases: [
        {
          binding: "DATABASE",
          database_name: name,
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  const d1 = (proxy.env as { DATABASE: D1Database }).DATABASE;
  const migrations = join(process.cwd(), "drizzle");
  for (const file of readdirSync(migrations)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()) {
    for (const statement of readFileSync(join(migrations, file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await d1.prepare(statement.trim()).run();
    }
  }
  (env as unknown as { DATABASE: D1Database }).DATABASE = d1;
  return {
    d1,
    dispose: async () => {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
