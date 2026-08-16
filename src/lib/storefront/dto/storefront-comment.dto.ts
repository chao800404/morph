import type { StorefrontCommentThreadStatus } from "@/db/storefront.schema";

export interface StorefrontCommentAuthorDTO {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface StorefrontCommentDTO {
  id: string;
  threadId: string;
  content: string;
  createdBy: string;
  authorId?: string;
  author: StorefrontCommentAuthorDTO;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontCommentGroupDTO {
  id: string;
  storefrontId: string;
  themeId: string;
  templateId: string;
  name: string;
  viewportWidth: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  threadCount?: number;
  openCount?: number;
  resolvedCount?: number;
}

export interface StorefrontCommentThreadDTO {
  id: string;
  storefrontId: string;
  themeId: string;
  templateId: string;
  groupId?: string | null;
  sectionId: string | null;
  nodeId: string | null;
  elementKey: string | null;
  viewportWidth?: number | null;
  viewport?: string | null;
  positionX: number;
  positionY: number;
  status: StorefrontCommentThreadStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdBy: string;
  authorId?: string;
  author: StorefrontCommentAuthorDTO;
  comments: StorefrontCommentDTO[];
  createdAt: string;
  updatedAt: string;
}
