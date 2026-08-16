export type StorefrontThemeFileDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  path: string;
  content: string;
  mimeType: string;
  isEntry: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StorefrontThemeFileTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: StorefrontThemeFileTreeNode[];
  size?: number;
  mimeType?: string;
};

export type StorefrontThemeRevisionDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  revisionNumber: number;
  message: string | null;
  source: "manual" | "ai" | "publish" | "rollback";
  snapshot: Array<{
    path: string;
    content: string;
    mimeType: string;
    isEntry: boolean;
  }>;
  createdBy: string | null;
  createdAt: string;
};
