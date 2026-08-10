import { Link } from "@tanstack/react-router";
import type React from "react";

/**
 * TanStack Router <Link> wrapper that accepts a plain `href` string
 * (e.g. "/dashboard/assets?folderId=abc").
 *
 * Internal navigation goes through the router's <Link> to remain client-side
 * and preserve the mounted view and query cache.
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
  preload?: "intent" | false;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children?: React.ReactNode;
}>;

export const RouterLink = ({ href, ...rest }: RouterLinkProps) => {
  const [to, queryString] = href.split("?");
  const search = Object.fromEntries(new URLSearchParams(queryString ?? ""));
  return <TanstackLink to={to} search={search} preload="intent" {...rest} />;
};
