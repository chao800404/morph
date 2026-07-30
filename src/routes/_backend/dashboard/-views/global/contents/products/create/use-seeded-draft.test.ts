import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const search = { current: {} as Record<string, unknown> };
const queryResult = { current: undefined as unknown };

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => search.current,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: queryResult.current }),
}));

vi.mock("@queries/product.queries", () => ({
  productOptionQueries: { detail: (id: string) => ({ queryKey: [id] }) },
}));

const { useSeededDraft } = await import("./use-seeded-draft");

const OPTION = {
  success: true,
  data: {
    id: "opt-1",
    title: "Size",
    values: [
      { id: "v1", value: "S" },
      { id: "v2", value: "M" },
    ],
  },
};

describe("useSeededDraft, option", () => {
  beforeEach(() => {
    search.current = {};
    queryResult.current = undefined;
  });

  it("does nothing without the search param", () => {
    queryResult.current = OPTION;
    const dispatch = vi.fn();

    renderHook(() => useSeededDraft(dispatch));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("waits for the option's values before applying it", () => {
    // The draft builds its variant matrix from the values, so applying the
    // option before they arrive would produce an axis with nothing on it.
    search.current = { seedOptionId: "opt-1" };
    const dispatch = vi.fn();

    renderHook(() => useSeededDraft(dispatch));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("turns on variants and selects every value", () => {
    search.current = { seedOptionId: "opt-1" };
    queryResult.current = OPTION;
    const dispatch = vi.fn();

    renderHook(() => useSeededDraft(dispatch));

    expect(dispatch).toHaveBeenCalledWith({
      type: "setHasVariants",
      value: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "addOption",
      option: {
        optionId: "opt-1",
        title: "Size",
        available: [
          { id: "v1", value: "S" },
          { id: "v2", value: "M" },
        ],
        selectedValueIds: ["v1", "v2"],
      },
    });
  });

  it("applies the option only once", () => {
    // A refetch must not re-add an option the author has since removed.
    search.current = { seedOptionId: "opt-1" };
    queryResult.current = OPTION;
    const dispatch = vi.fn();

    const { rerender } = renderHook(() => useSeededDraft(dispatch));
    rerender();
    rerender();

    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe("useSeededDraft, category", () => {
  beforeEach(() => {
    search.current = {};
    queryResult.current = undefined;
  });

  it("assigns the category without waiting for a query", () => {
    // The id is the whole value here, unlike an option whose values decide the
    // variant matrix.
    search.current = { seedCategoryId: "cat-1" };
    const dispatch = vi.fn();

    renderHook(() => useSeededDraft(dispatch));

    expect(dispatch).toHaveBeenCalledWith({
      type: "setCategoryIds",
      ids: ["cat-1"],
    });
  });

  it("assigns it only once", () => {
    search.current = { seedCategoryId: "cat-1" };
    const dispatch = vi.fn();

    const { rerender } = renderHook(() => useSeededDraft(dispatch));
    rerender();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("useSeededDraft, collection", () => {
  beforeEach(() => {
    search.current = {};
    queryResult.current = undefined;
  });

  it("selects the collection immediately and only once", () => {
    search.current = { seedCollectionId: "col-1" };
    const dispatch = vi.fn();

    const { rerender } = renderHook(() => useSeededDraft(dispatch));
    rerender();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setField",
      field: "collectionId",
      value: "col-1",
    });
  });

  it("applies every seed present, not just the first", () => {
    // A page could offer more than one starting point; each seed is
    // independent, so none may swallow the others.
    search.current = { seedCategoryId: "cat-1", seedCollectionId: "col-1" };
    const dispatch = vi.fn();

    renderHook(() => useSeededDraft(dispatch));

    expect(dispatch).toHaveBeenCalledWith({
      type: "setCategoryIds",
      ids: ["cat-1"],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setField",
      field: "collectionId",
      value: "col-1",
    });
  });
});
