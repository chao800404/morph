import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * How long `waitFor` and `findBy*` may wait.
 *
 * Independent of `testTimeout` in `vitest.config.ts`, and left at Testing
 * Library's 1s default until it started failing the run intermittently.
 *
 * The margin was the problem, not the feature. `editor-code-workspace.tsx`
 * schedules its auto-save 700ms after a change settles, in two places — the
 * per-file draft save and the save that follows a file operation — so an
 * assertion waiting on either had 300ms of budget left for everything else.
 * The same path already measured 753-783ms on an idle machine. Under a full
 * run, where suites compete for the CPU, it crossed 1s and failed a case that
 * passes in isolation, which is the same failure mode `testTimeout` was raised
 * for.
 *
 * Confirmed by running the whole suite three times back to back with the
 * machine already loaded: green each time, where before the change a run could
 * lose one case at random.
 *
 * This is headroom for a signal that is genuinely scheduled, not patience for a
 * hang: a `waitFor` that will never be satisfied still fails, just five seconds
 * later instead of one. A call site that needs a different budget can still
 * pass its own `timeout`.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * Browser APIs jsdom does not implement.
 *
 * Radix positions its popovers with `ResizeObserver`, so any test that opens a
 * Popover, Select or Dropdown throws without this. Stubbing it is enough:
 * layout is not what these tests assert on.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix also probes these before deciding how to place a floating element.
globalThis.DOMRect ??= class DOMRectStub {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  get top() {
    return this.y;
  }
  get left() {
    return this.x;
  }
  get right() {
    return this.x + this.width;
  }
  get bottom() {
    return this.y + this.height;
  }
  toJSON() {
    return { ...this };
  }
  static fromRect(rect?: DOMRectInit) {
    return new DOMRectStub(rect?.x, rect?.y, rect?.width, rect?.height);
  }
} as unknown as typeof DOMRect;

/**
 * jsdom has no media queries at all, and anything that adapts to viewport or
 * to `prefers-reduced-motion` calls this during its first render. Reported as
 * "no match", which is the honest answer for a document with no layout.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * Node 22+ introduces an experimental built-in `localStorage` that lacks standard
 * Web Storage methods (`clear`, `removeItem`, `setItem`, `getItem`) unless
 * `--localstorage-file` is configured. Polyfill standard mock Storage if missing.
 */
if (
  typeof window !== "undefined" &&
  typeof window.localStorage?.removeItem !== "function"
) {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.get(key) ?? null;
    }
    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }

  const memoryStorage = new MemoryStorage();
  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}

/**
 * Unmount between tests.
 *
 * Testing Library registers this itself, but only when Vitest globals are
 * enabled — and they are not here, so without it every render stacks up in the
 * same document and queries start matching the previous test's markup.
 */
if (typeof window !== "undefined") {
  afterEach(cleanup);
}
