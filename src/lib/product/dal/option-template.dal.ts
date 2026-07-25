import { getDb } from "@/db";
import { optionTemplateValues, optionTemplates } from "@/db/product.schema";
import { and, asc, count, desc, eq, inArray, isNull, like, SQL } from "drizzle-orm";
import type {
  OptionTemplateDTO,
  OptionTemplateInsertDTO,
  UpdateOptionTemplateDTO,
} from "../dto/option-template.dto";
import {
  toOptionTemplateDTO,
  type OptionTemplateRow,
  type OptionTemplateValueRow,
} from "../mappers/option-template.mapper";
import { chunk, chunkForInsert } from "./d1-batch";

// Column counts drive the insert batch size; see d1-batch.ts.
const TEMPLATE_VALUE_COLUMNS = 6;

/** Load the values for a set of templates, then assemble the DTOs. */
const hydrate = async (
  templateRows: OptionTemplateRow[],
): Promise<OptionTemplateDTO[]> => {
  if (templateRows.length === 0) return [];
  const db = await getDb();
  const valueRows: OptionTemplateValueRow[] = [];

  for (const ids of chunk(
    templateRows.map((row) => row.id),
    50,
  )) {
    valueRows.push(
      ...(await db
        .select()
        .from(optionTemplateValues)
        .where(inArray(optionTemplateValues.templateId, ids))),
    );
  }

  return templateRows.map((row) => toOptionTemplateDTO(row, valueRows));
};

const replaceValues = async (
  templateId: string,
  values: string[],
): Promise<void> => {
  const db = await getDb();
  const now = new Date().toISOString();

  await db
    .delete(optionTemplateValues)
    .where(eq(optionTemplateValues.templateId, templateId));

  const rows = values.map((value, index) => ({
    id: crypto.randomUUID(),
    templateId,
    value,
    rank: index,
    createdAt: now,
    updatedAt: now,
  }));
  for (const group of chunkForInsert(rows, TEMPLATE_VALUE_COLUMNS)) {
    await db.insert(optionTemplateValues).values(group);
  }
};

export const optionTemplateDal = {
  async findById(id: string): Promise<OptionTemplateDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(optionTemplates)
      .where(and(eq(optionTemplates.id, id), isNull(optionTemplates.deletedAt)))
      .limit(1);
    const hydrated = await hydrate(rows);
    return hydrated[0] ?? null;
  },

  async findByTitle(title: string): Promise<OptionTemplateDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(optionTemplates)
      .where(
        and(
          eq(optionTemplates.title, title),
          isNull(optionTemplates.deletedAt),
        ),
      )
      .limit(1);
    const hydrated = await hydrate(rows);
    return hydrated[0] ?? null;
  },

  async findByIds(ids: string[]): Promise<OptionTemplateDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows: OptionTemplateRow[] = [];
    for (const group of chunk(ids, 50)) {
      rows.push(
        ...(await db
          .select()
          .from(optionTemplates)
          .where(
            and(
              inArray(optionTemplates.id, group),
              isNull(optionTemplates.deletedAt),
            ),
          )),
      );
    }
    return hydrate(rows);
  },

  async listPage(options: {
    query?: string | null;
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ templates: OptionTemplateDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(optionTemplates.deletedAt)];

    if (options.query?.trim()) {
      conditions.push(
        like(optionTemplates.title, `%${options.query.trim()}%`) as SQL,
      );
    }

    const sortColumn = {
      title: optionTemplates.title,
      createdAt: optionTemplates.createdAt,
      updatedAt: optionTemplates.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(optionTemplates).where(condition),
      db
        .select()
        .from(optionTemplates)
        .where(condition)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      templates: await hydrate(rows),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async create(data: OptionTemplateInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db.insert(optionTemplates).values({
      id: data.id,
      title: data.title,
      rank: data.rank ?? 0,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
      createdAt: data.createdAt?.toISOString() ?? now,
      updatedAt: data.updatedAt?.toISOString() ?? now,
    });

    await replaceValues(data.id, data.values);
  },

  async update(id: string, data: UpdateOptionTemplateDTO): Promise<void> {
    const db = await getDb();

    await db
      .update(optionTemplates)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.rank !== undefined ? { rank: data.rank } : {}),
        updatedBy: data.updatedBy,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(optionTemplates.id, id), isNull(optionTemplates.deletedAt)),
      );

    if (data.values) {
      await replaceValues(id, data.values);
    }
  },

  async softDelete(ids: string[], updatedBy: string): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (const group of chunk(ids, 50)) {
      await db
        .update(optionTemplates)
        .set({ deletedAt: now, updatedAt: now, updatedBy })
        .where(
          and(
            inArray(optionTemplates.id, group),
            isNull(optionTemplates.deletedAt),
          ),
        );
    }
  },
};
