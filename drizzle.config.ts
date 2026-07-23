import { defineConfig } from "drizzle-kit";
import fs from "node:fs";
import path from "node:path";

function getLocalD1DB() {
  try {
    // Look specifically in the d1 directory for D1 databases
    const basePath = path.resolve(".wrangler/state/v3/d1");

    if (!fs.existsSync(basePath)) {
      return null;
    }

    const dbFile = fs
      .readdirSync(basePath, { encoding: "utf-8", recursive: true })
      .find((f) => f.endsWith(".sqlite"));

    if (!dbFile) {
      return null;
    }

    const url = path.resolve(basePath, dbFile);
    console.log(`Using local D1 database: ${url}`);
    return url;
  } catch (err) {
    console.warn(`Could not find local D1 database: ${err}`);
    return null;
  }
}

const localD1DBUrl = getLocalD1DB();
const useRemoteD1 = process.env.DRIZZLE_TARGET === "remote";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(useRemoteD1
    ? {
        driver: "d1-http",
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      }
    : localD1DBUrl
      ? {
          dbCredentials: {
            url: localD1DBUrl,
          },
        }
      : {}),
});
