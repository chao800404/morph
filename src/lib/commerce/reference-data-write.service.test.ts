import type { ReferenceDataItemDTO } from "@/lib/commerce/reference-data";
import type { ReferenceDataWriteDal } from "./reference-data-write.service";
import { createReferenceDataWriteService } from "./reference-data-write.service";
import { describe, expect, it, vi } from "vitest";

const reasonId = "550e8400-e29b-41d4-a716-446655440000";
const childId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";

const item = (
  overrides: Partial<ReferenceDataItemDTO> = {},
): ReferenceDataItemDTO => ({
  id: reasonId,
  name: "Damaged",
  externalId: null,
  code: "damaged",
  description: null,
  parentId: null,
  parentName: null,
  usageCount: 0,
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeDal = (overrides: Record<string, unknown> = {}) =>
  ({
    list: vi.fn(async () => ({ items: [], pagination: { total: 0 } })),
    find: vi.fn(async () => item()),
    duplicateExists: vi.fn(async () => false),
    create: vi.fn(async () => childId),
    update: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
    hasChildren: vi.fn(async () => false),
    ...overrides,
  }) as unknown as ReferenceDataWriteDal;

describe("referenceDataWriteService", () => {
  it("creates normalized reference records and prevents duplicate values", async () => {
    const dal = makeDal();
    const service = createReferenceDataWriteService({ dal });
    const created = await service.create({
      kind: "product-types",
      name: "Outerwear",
      externalId: "outerwear",
      metadata: { source: "admin" },
    });
    expect(created).toMatchObject({ success: true, data: { id: childId } });
    expect(dal.create).toHaveBeenCalledWith("product-types", {
      kind: "product-types",
      name: "Outerwear",
      externalId: "outerwear",
      metadata: { source: "admin" },
    });

    vi.mocked(dal.duplicateExists).mockResolvedValueOnce(true);
    const duplicate = await service.create({
      kind: "product-types",
      name: "Outerwear",
    });
    expect(duplicate).toMatchObject({
      success: false,
      error: "DUPLICATE_VALUE",
    });
    expect(dal.create).toHaveBeenCalledOnce();
  });

  it("requires a code and validates the return reason parent depth", async () => {
    const dal = makeDal();
    const service = createReferenceDataWriteService({ dal });
    const noCode = await service.create({
      kind: "return-reasons",
      name: "Damaged",
    });
    expect(noCode).toMatchObject({ success: false, error: "INVALID_INPUT" });

    vi.mocked(dal.find).mockResolvedValueOnce(
      item({ id: childId, parentId: reasonId }),
    );
    const invalidParent = await service.create({
      kind: "return-reasons",
      name: "Damaged in transit",
      code: "damaged-transit",
      parentId: childId,
    });
    expect(invalidParent).toMatchObject({
      success: false,
      error: "INVALID_PARENT",
    });
    expect(dal.create).not.toHaveBeenCalled();
  });

  it("updates partial values, blocks self-parenting and protects in-use or parent rows", async () => {
    const dal = makeDal();
    const service = createReferenceDataWriteService({ dal });
    const updated = await service.update({
      kind: "product-tags",
      id: reasonId,
      externalId: null,
      metadata: { source: "sync" },
    });
    expect(updated).toMatchObject({ success: true, data: { id: reasonId } });
    expect(dal.update).toHaveBeenCalledWith("product-tags", reasonId, {
      kind: "product-tags",
      id: reasonId,
      externalId: null,
      metadata: { source: "sync" },
    });

    const selfParent = await service.update({
      kind: "return-reasons",
      id: reasonId,
      parentId: reasonId,
    });
    expect(selfParent).toMatchObject({
      success: false,
      error: "INVALID_PARENT",
    });

    vi.mocked(dal.find).mockResolvedValueOnce(item({ usageCount: 1 }));
    const inUse = await service.deleteMany({
      kind: "return-reasons",
      ids: [reasonId],
    });
    expect(inUse).toMatchObject({ success: false, error: "IN_USE" });

    vi.mocked(dal.find).mockResolvedValueOnce(item());
    vi.mocked(dal.hasChildren).mockResolvedValueOnce(true);
    const hasChildren = await service.deleteMany({
      kind: "return-reasons",
      ids: [reasonId],
    });
    expect(hasChildren).toMatchObject({
      success: false,
      error: "HAS_CHILDREN",
    });
    expect(dal.softDelete).not.toHaveBeenCalled();
  });
});
