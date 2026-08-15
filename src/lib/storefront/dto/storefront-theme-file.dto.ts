export type StorefrontThemeFileDTO = {
  id: string;
  storefrontId: string;
  themeId: string;
  path: string;
  content: string;
  mimeType: string;
  isEntry: boolean;
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
