import {
  d1ThemeRevisionStore,
  d1ThemeSourceStore,
} from "./d1-theme-storage";
import type {
  ThemeRevisionStore,
  ThemeSourceStore,
} from "./theme-storage.types";

/**
 * Server-side composition root for theme source storage.
 *
 * Callers depend on backend-agnostic contracts. Only this module selects the
 * current D1-backed implementations, so a future workspace/object backend can
 * be swapped here without leaking D1 knowledge into ServerFns or services.
 */
export const themeSourceStore: ThemeSourceStore = d1ThemeSourceStore;
export const themeRevisionStore: ThemeRevisionStore = d1ThemeRevisionStore;
