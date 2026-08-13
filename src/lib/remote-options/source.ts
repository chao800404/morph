export const REMOTE_OPTION_SOURCES = [
  "asset-folders",
  "promotion-campaigns",
  "product-types",
  "product-tags",
  "product-categories",
] as const;

export type RemoteOptionSource = (typeof REMOTE_OPTION_SOURCES)[number];
