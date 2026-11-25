/**
 * `node --import tsx --import ./scripts/client-lane-theme/register.mjs ...`:
 * resolves `cloudflare:workers`, which only exists inside workerd, to
 * `cloudflare-workers-env.mjs`, as vitest.config.ts aliases it for tests.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
