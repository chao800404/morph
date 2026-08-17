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
 * Unmount between tests.
 *
 * Testing Library registers this itself, but only when Vitest globals are
 * enabled — and they are not here, so without it every render stacks up in the
 * same document and queries start matching the previous test's markup.
 */
if (typeof window !== "undefined") {
  afterEach(cleanup);
}

