import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useResponsiveTablePageSize } from "./use-responsive-table-page-size";

const Harness = ({ showTable }: { showTable: boolean }) => {
  const { containerRef, pageSize, isMeasured } =
    useResponsiveTablePageSize({
      rowHeight: 48,
      headerHeight: 48,
      fallback: 10,
    });

  return (
    <>
      <output data-testid="result">
        {pageSize}:{String(isMeasured)}
      </output>
      {showTable ? <div ref={containerRef} /> : null}
    </>
  );
};

describe("useResponsiveTablePageSize lifecycle", () => {
  it("starts measuring when a table mounts after the loading state", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 768,
    });
    const view = render(<Harness showTable={false} />);
    expect(screen.getByTestId("result").textContent).toBe("10:false");

    view.rerender(<Harness showTable />);

    expect(screen.getByTestId("result").textContent).toBe("15:true");
  });
});
