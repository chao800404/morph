import { describe, expect, it, vi } from "vitest";
import { lazyView, viewPreloader } from "./lazy-view";

const view = () => null;

describe("lazyView", () => {
  it("does not import until asked", () => {
    const factory = vi.fn(async () => ({ default: view }));

    lazyView(factory);

    expect(factory).not.toHaveBeenCalled();
  });

  it("imports once however many times preload is called", async () => {
    // Hover, focus and touchstart can all fire for one interaction; each must
    // not start its own request.
    const factory = vi.fn(async () => ({ default: view }));
    const preload = viewPreloader(lazyView(factory));

    await Promise.all([preload?.(), preload?.(), preload?.()]);

    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("viewPreloader", () => {
  it("returns nothing for a view that was not declared with lazyView", () => {
    // A plain component is still a valid view; it just has no chunk to warm.
    expect(viewPreloader(view)).toBeUndefined();
    expect(viewPreloader(undefined)).toBeUndefined();
  });
});
