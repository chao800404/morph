import { lazy, type ComponentType } from "react";

/**
 * A lazily-loaded view that can start fetching its chunk early.
 *
 * `React.lazy` only begins the import when the component first renders, so a
 * route-backed overlay shows its pending frame while the chunk downloads. The
 * work is the same either way; starting it on hover or focus just moves it
 * before the click instead of after.
 */
export interface ViewPreload {
  /** Idempotent: the first call starts the import, later ones reuse it. */
  preload: () => Promise<unknown>;
}

/**
 * Declare a config view.
 *
 * Use this instead of `lazy(...)` so the import factory is available for
 * preloading. The path is written once — a separate `preload` entry beside
 * `view` would be two places to keep in step, and the drift would be silent.
 */
export const lazyView = (
  factory: () => Promise<{ default: ComponentType }>,
): ComponentType => {
  const Component = lazy(factory) as unknown as ComponentType & ViewPreload;

  let started: Promise<unknown> | undefined;
  Component.preload = () => (started ??= factory());

  return Component as unknown as ComponentType;
};

/** The preloader for a view, when it was declared with `lazyView`. */
export const viewPreloader = (
  view: ComponentType | undefined,
): (() => Promise<unknown>) | undefined => {
  if (!view) return undefined;
  const candidate = view as Partial<ViewPreload>;
  return typeof candidate.preload === "function"
    ? candidate.preload
    : undefined;
};
