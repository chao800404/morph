/**
 * `cloudflare:workers` for the client lane's seed, which runs the
 * application's DAL in Node. The seed sets `env.DATABASE` to the run's D1
 * binding (from `getPlatformProxy`) before calling anything that reads it.
 */
export const env = {};
