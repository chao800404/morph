/**
 * Test-only: calls the `.astro` parser through Core's real `ASTRO_PARSER`
 * service binding and answers with the outcome, so a local check can see the
 * binding work from inside Core rather than from a test double.
 *
 * Fenced three ways, any one of which keeps it out of production:
 *
 * 1. `src/server.ts` imports this module only under `import.meta.env.DEV`,
 *    which a production build replaces with `false`, so the branch and this
 *    module are not in a deployed Worker at all;
 * 2. it answers 404 when the environment looks like production;
 * 3. it answers 404 when there is no `ASTRO_PARSER` binding, which only
 *    `env.local_preview_e2e` in wrangler.jsonc declares (a test pins that the
 *    top level, which is what deploys, has none). Plain `pnpm dev` has none.
 *
 * It takes no input: the source is fixed (the ROADMAP's Astro homepage case,
 * with non-ASCII text before the first element so UTF-16 and UTF-8 offsets
 * differ), and the answer carries ranges and versions only.
 */
import { MORPH_ASTRO_COMPILER_RS_VERSION } from "@/lib/storefront/source-language/astro-compiler-version";
import {
  astroParserBindingFrom,
  parseAstroTemplate,
} from "@/lib/storefront/source-language/astro-parser-client";
import { isProductionEnvironment } from "@/lib/storefront/service/storefront-domain-provider";

export const ASTRO_PARSER_BINDING_CHECK_PATH =
  "/_morph/e2e/astro-parser-binding-check";

export const ASTRO_PARSER_BINDING_CHECK_SOURCE = [
  "---",
  'import Hero from "../components/Hero.astro";',
  "// 首頁 café",
  'const home = await morph.pages.get("/");',
  "const { hero } = home;",
  "---",
  "<Hero {...hero} />",
  "<p>Café {hero.title}</p>",
  "",
].join("\n");

const notFound = () => new Response("Not Found", { status: 404 });

/** Null for any other path, so the caller goes on as before. */
export async function serveAstroParserBindingCheck(
  request: Request,
  env: Record<string, unknown>,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== ASTRO_PARSER_BINDING_CHECK_PATH)
    return null;
  if (isProductionEnvironment(env)) return notFound();
  const binding = astroParserBindingFrom(env);
  if (!binding) return notFound();
  if (request.method !== "GET")
    return new Response("Method Not Allowed", { status: 405 });

  const outcome = await parseAstroTemplate(
    binding,
    ASTRO_PARSER_BINDING_CHECK_SOURCE,
  );
  return Response.json(
    {
      pinnedCompiler: MORPH_ASTRO_COMPILER_RS_VERSION,
      source: ASTRO_PARSER_BINDING_CHECK_SOURCE,
      outcome,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
