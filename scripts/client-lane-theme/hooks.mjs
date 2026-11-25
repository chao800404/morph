const ENV_MODULE = new URL("./cloudflare-workers-env.mjs", import.meta.url).href;

/** @type {import("node:module").ResolveHook} */
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") {
    return { url: ENV_MODULE, shortCircuit: true };
  }
  return next(specifier, context);
}
