import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * Node 22+ introduces an experimental built-in `localStorage` that lacks standard
 * Web Storage methods (`clear`, `removeItem`, `setItem`, `getItem`) unless
 * `--localstorage-file` is configured. Polyfill standard mock Storage if missing.
 */
if (typeof window !== "undefined" && typeof window.localStorage?.removeItem !== "function") {
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

