import { optionTemplateValues, optionTemplates } from "@/db/product.schema";
import type {
  OptionTemplateDTO,
  OptionTemplateValueDTO,
} from "../dto/option-template.dto";

export type OptionTemplateRow = typeof optionTemplates.$inferSelect;
export type OptionTemplateValueRow = typeof optionTemplateValues.$inferSelect;

export const toOptionTemplateValueDTO = (
  row: OptionTemplateValueRow,
): OptionTemplateValueDTO => ({
  id: row.id,
  templateId: row.templateId,
  value: row.value,
  rank: row.rank,
});

export const toOptionTemplateDTO = (
  row: OptionTemplateRow,
  valueRows: OptionTemplateValueRow[] = [],
): OptionTemplateDTO => ({
  id: row.id,
  title: row.title,
  rank: row.rank,
  values: valueRows
    .filter((value) => value.templateId === row.id)
    .sort((a, b) => a.rank - b.rank)
    .map(toOptionTemplateValueDTO),
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
