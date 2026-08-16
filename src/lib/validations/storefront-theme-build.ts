import { z } from "zod";
import { idSchema } from "./commerce";

export const createStorefrontThemeBuildInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  sourceRevisionId: z.string().uuid("Invalid source revision ID"),
});

export type CreateStorefrontThemeBuildInput = z.infer<
  typeof createStorefrontThemeBuildInputSchema
>;

export const getStorefrontThemeBuildInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  buildId: idSchema("storefront theme build"),
});

export type GetStorefrontThemeBuildInput = z.infer<
  typeof getStorefrontThemeBuildInputSchema
>;

export const listStorefrontThemeBuildsInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListStorefrontThemeBuildsInput = z.infer<
  typeof listStorefrontThemeBuildsInputSchema
>;

export const markBuildStartedInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  buildId: idSchema("storefront theme build"),
  inputHash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, "inputHash must be 64-character SHA-256 hex"),
  compilerId: z.string().trim().min(1).max(100),
  compilerVersion: z.string().trim().min(1).max(50),
});

export type MarkBuildStartedInput = z.infer<typeof markBuildStartedInputSchema>;

export const markBuildSucceededInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  buildId: idSchema("storefront theme build"),
  artifactPrefix: z.string().trim().max(255).optional(),
  manifestJson: z.any().optional(),
  diagnosticsJson: z.any().optional(),
});


export type MarkBuildSucceededInput = z.infer<
  typeof markBuildSucceededInputSchema
>;

export const markBuildFailedInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  buildId: idSchema("storefront theme build"),
  errorMessage: z.string().trim().min(1).max(2000),
  diagnosticsJson: z.any().optional(),
});

export type MarkBuildFailedInput = z.infer<typeof markBuildFailedInputSchema>;
