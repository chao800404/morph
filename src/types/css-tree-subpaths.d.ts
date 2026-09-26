// `@types/css-tree` declares the package root only. The subpaths load the
// parser and walker without the syntax data the root bundles.
declare module "css-tree/parser" {
  import type { parse } from "css-tree";
  const parser: typeof parse;
  export default parser;
}

declare module "css-tree/walker" {
  import type { walk } from "css-tree";
  const walker: typeof walk;
  export default walker;
}
