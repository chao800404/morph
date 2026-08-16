import { z } from "zod";
import { idSchema } from "./commerce";

export const createStorefrontCommentGroupInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  templateId: idSchema("storefront theme template"),
  name: z.string().trim().min(1, "Group name cannot be empty").max(100),
  viewportWidth: z.number().int().min(100).max(5000).default(1440),
});

export const updateStorefrontCommentGroupInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  groupId: idSchema("storefront comment group"),
  name: z.string().trim().min(1, "Group name cannot be empty").max(100).optional(),
  viewportWidth: z.number().int().min(100).max(5000).optional(),
});

export const deleteStorefrontCommentGroupInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  groupId: idSchema("storefront comment group"),
});

export const listStorefrontCommentGroupsInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  templateId: idSchema("storefront theme template"),
});

export const createStorefrontCommentThreadInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  templateId: idSchema("storefront theme template"),
  groupId: z.string().trim().max(100).optional().nullable(),
  sectionId: z.string().trim().max(100).optional().nullable(),
  nodeId: z.string().trim().max(160).optional().nullable(),
  elementKey: z.string().trim().max(100).optional().nullable(),
  viewportWidth: z.number().int().min(100).max(5000).optional().nullable(),
  viewport: z.string().trim().max(50).optional().nullable(),
  positionX: z.number().min(0).max(100).default(50),
  positionY: z.number().min(0).max(100).default(50),
  content: z.string().trim().min(1, "Comment content cannot be empty").max(2000),
});

export const replyStorefrontCommentInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  threadId: idSchema("storefront comment thread"),
  content: z.string().trim().min(1, "Reply content cannot be empty").max(2000),
});

export const resolveStorefrontCommentThreadInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  threadId: idSchema("storefront comment thread"),
  resolved: z.boolean(),
});

export const deleteStorefrontCommentThreadInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  threadId: idSchema("storefront comment thread"),
});

export const deleteStorefrontCommentInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  commentId: idSchema("storefront comment"),
});

export const listStorefrontCommentThreadsInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  templateId: idSchema("storefront theme template"),
  groupId: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["all", "open", "resolved"]).default("all"),
});

export const updateStorefrontCommentThreadPositionInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  threadId: idSchema("storefront comment thread"),
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  sectionId: z.string().trim().max(100).optional().nullable(),
  nodeId: z.string().trim().max(160).optional().nullable(),
  elementKey: z.string().trim().max(100).optional().nullable(),
});

export type CreateStorefrontCommentGroupInput = z.infer<
  typeof createStorefrontCommentGroupInputSchema
>;
export type UpdateStorefrontCommentGroupInput = z.infer<
  typeof updateStorefrontCommentGroupInputSchema
>;
export type DeleteStorefrontCommentGroupInput = z.infer<
  typeof deleteStorefrontCommentGroupInputSchema
>;
export type ListStorefrontCommentGroupsInput = z.infer<
  typeof listStorefrontCommentGroupsInputSchema
>;

export type CreateStorefrontCommentThreadInput = z.infer<
  typeof createStorefrontCommentThreadInputSchema
>;
export type UpdateStorefrontCommentThreadPositionInput = z.infer<
  typeof updateStorefrontCommentThreadPositionInputSchema
>;
export type ReplyStorefrontCommentInput = z.infer<
  typeof replyStorefrontCommentInputSchema
>;
export type ResolveStorefrontCommentThreadInput = z.infer<
  typeof resolveStorefrontCommentThreadInputSchema
>;
export type DeleteStorefrontCommentThreadInput = z.infer<
  typeof deleteStorefrontCommentThreadInputSchema
>;
export type DeleteStorefrontCommentInput = z.infer<
  typeof deleteStorefrontCommentInputSchema
>;
export type ListStorefrontCommentThreadsInput = z.infer<
  typeof listStorefrontCommentThreadsInputSchema
>;
