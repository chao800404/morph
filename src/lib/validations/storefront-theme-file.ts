import { z } from "zod";

export const listThemeFilesInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const getThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: z.string().min(1),
});

export const saveThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  mimeType: z.string().optional(),
});

export const deleteThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: z.string().min(1),
});
