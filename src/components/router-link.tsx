import { Link } from "@tanstack/react-router";
import type React from "react";

/**
 * TanStack Router <Link> wrapper that accepts a plain `href` string
 * (e.g. "/dashboard/assets?folderId=abc"), the way `next/link` did.
 *
 * This project runs on TanStack Router, so navigation must go through the
 * router's <Link> to stay client-side. A `next/link` / plain anchor triggers a
 * full page reload, which unmounts the whole view and discards the query cache.
 *
 * The href is split into the router's `{ to, search }` shape. An explicit
 * `search` object is always passed so navigating to a plain path clears any
 * stale query params (e.g. `folderId`) instead of preserving them.
 */
type RouterLinkProps = {
  href: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children?: React.ReactNode;
};

const TanstackLink = Link as unknown as React.ComponentType<{
  to: string;
  search?: Record<string, string>;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children?: React.ReactNode;
}>;

export const RouterLink = ({ href, ...rest }: RouterLinkProps) => {
  const [to, queryString] = href.split("?");
  const search = Object.fromEntries(new URLSearchParams(queryString ?? ""));
  return <TanstackLink to={to} search={search} {...rest} />;
};
