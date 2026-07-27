import { useCallback, useEffect, useState } from "react";

export interface ResponsiveTablePageSizeOptions {
  rowHeight: number;
  headerHeight: number;
  fallback: number;
  minRows?: number;
}

export const calculateResponsiveTablePageSize = (
  availableHeight: number,
  {
    rowHeight,
    headerHeight,
    fallback,
    minRows = 1,
  }: ResponsiveTablePageSizeOptions,
) => {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
    return fallback;
  }

  return Math.max(
    minRows,
    Math.floor((availableHeight - headerHeight) / rowHeight),
  );
};

export const calculatePageForPreservedOffset = (
  previousPage: number,
  previousPageSize: number,
  nextPageSize: number,
) => {
  const firstVisibleIndex = (Math.max(1, previousPage) - 1) * previousPageSize;
  return Math.floor(firstVisibleIndex / nextPageSize) + 1;
};

/**
 * Derives a page size from the table's real viewport rather than the window.
 *
 * The observed element must contain only the table area. Toolbars, pagination
 * and route footer stay outside it, so their actual rendered heights are
 * already deducted by flex layout before this hook measures anything.
 */
export const useResponsiveTablePageSize = (
  options: ResponsiveTablePageSizeOptions,
) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(options.fallback);
  const [isMeasured, setIsMeasured] = useState(false);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
    if (!node) setIsMeasured(false);
  }, []);

  useEffect(() => {
    if (!container) return;

    const update = () => {
      if (container.clientHeight <= 0) return;
      const next = calculateResponsiveTablePageSize(
        container.clientHeight,
        options,
      );
      setPageSize((current) => (current === next ? current : next));
      setIsMeasured(true);
    };

    update();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    container,
    options.fallback,
    options.headerHeight,
    options.minRows,
    options.rowHeight,
  ]);

  return { containerRef, pageSize, isMeasured };
};
