import { render } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ScrollArea } from "./scroll-area";

describe("ScrollArea", () => {
  it("does not loop when attaching its root updates the parent", () => {
    function MeasuredPanel() {
      const [attachments, setAttachments] = useState(0);
      const measureRoot = useCallback((node: HTMLDivElement | null) => {
        if (node) setAttachments((count) => count + 1);
      }, []);
      return (
        <ScrollArea ref={measureRoot} className="h-40">
          Root attachments: {attachments}
        </ScrollArea>
      );
    }

    const view = render(<MeasuredPanel />);
    expect(view.container.textContent).toContain("Root attachments: 1");
  });

  it("keeps its root ref attached while content rerenders", () => {
    // React 19 detaches changed callback refs. A composed ref that changes
    // during every render can repeatedly set Radix's root state null/node,
    // eventually crashing the editor instead of merely updating its content.
    const rootRef = vi.fn();
    const view = render(
      <ScrollArea ref={rootRef} className="h-40">
        First content
      </ScrollArea>,
    );
    const root = view.container.querySelector('[data-slot="scroll-area"]');
    rootRef.mockClear();

    for (let index = 0; index < 20; index += 1) {
      view.rerender(
        <ScrollArea ref={rootRef} className="h-40">
          Updated content {index}
        </ScrollArea>,
      );
    }

    expect(view.container.querySelector('[data-slot="scroll-area"]')).toBe(
      root,
    );
    expect(rootRef).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Updated content 19");
  });
});
