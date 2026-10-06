import { z } from "zod";

/** Publishing policy, not Router navigation or a second page registry. */
export const storefrontConcreteRenderPolicySchema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("ssr") }).strict(),
    z.object({ mode: z.literal("ssg") }).strict(),
    z.object({ mode: z.literal("csr") }).strict(),
    z
      .object({
        mode: z.literal("isr"),
        // An explicit positive interval; never interpret 0 as "cache forever".
        revalidateSeconds: z.number().int().positive().max(604_800),
      })
      .strict(),
  ],
);

export const storefrontPageRenderPolicySchema = z.union([
  z.object({ mode: z.literal("inherit") }).strict(),
  storefrontConcreteRenderPolicySchema,
]);

export type StorefrontConcreteRenderPolicy = z.infer<
  typeof storefrontConcreteRenderPolicySchema
>;
export type StorefrontPageRenderPolicy = z.infer<
  typeof storefrontPageRenderPolicySchema
>;

/** Missing legacy settings mean SSR. Malformed settings never mean SSR. */
export function resolveStorefrontRenderPolicy(input: {
  website?: unknown;
  page?: unknown;
}):
  | {
      success: true;
      policy: StorefrontConcreteRenderPolicy;
      inherited: boolean;
    }
  | {
      success: false;
      code: "INVALID_WEBSITE_RENDER_POLICY" | "INVALID_PAGE_RENDER_POLICY";
    } {
  const website = storefrontConcreteRenderPolicySchema.safeParse(
    input.website === undefined ? { mode: "ssr" } : input.website,
  );
  if (!website.success) {
    return { success: false, code: "INVALID_WEBSITE_RENDER_POLICY" };
  }
  const page = storefrontPageRenderPolicySchema.safeParse(
    input.page === undefined ? { mode: "inherit" } : input.page,
  );
  if (!page.success) {
    return { success: false, code: "INVALID_PAGE_RENDER_POLICY" };
  }
  return page.data.mode === "inherit"
    ? { success: true, policy: website.data, inherited: true }
    : { success: true, policy: page.data, inherited: false };
}

/**
 * Caller must establish personalization from trusted route capabilities.
 * This does not infer it from a URL or accept a client-supplied security flag.
 * SSG is also shared HTML: protecting only ISR would leak the same data at
 * build time instead of request time. Reject rather than silently change an
 * explicit publishing choice.
 */
export function validateStorefrontRenderEligibility(input: {
  policy: StorefrontConcreteRenderPolicy;
  personalized: boolean;
}):
  | { success: true }
  | { success: false; code: "PERSONALIZED_SHARED_HTML_REFUSED" } {
  if (
    input.personalized &&
    (input.policy.mode === "ssg" || input.policy.mode === "isr")
  ) {
    return { success: false, code: "PERSONALIZED_SHARED_HTML_REFUSED" };
  }
  return { success: true };
}
