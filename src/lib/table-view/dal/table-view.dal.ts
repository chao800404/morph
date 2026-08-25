import { getDb } from "@/db";
import {
  userTableViews,
  type TableViewConfiguration,
} from "@/db/table-view.schema";
import { and, eq } from "drizzle-orm";
import { firstOrNull } from "@/lib/db/single-row";

const DEFAULT_VIEW_NAME = "Default";

export const tableViewDal = {
  async findDefault(userId: string, tableKey: string) {
    const db = await getDb();
    const rows = await db
      .select({ configuration: userTableViews.configuration })
      .from(userTableViews)
      .where(
        and(
          eq(userTableViews.userId, userId),
          eq(userTableViews.tableKey, tableKey),
          eq(userTableViews.name, DEFAULT_VIEW_NAME),
        ),
      )
      .limit(1);
    return firstOrNull(rows)?.configuration ?? null;
  },

  async upsertDefault(
    userId: string,
    tableKey: string,
    configuration: TableViewConfiguration,
  ) {
    const db = await getDb();
    await db
      .insert(userTableViews)
      .values({
        id: crypto.randomUUID(),
        userId,
        tableKey,
        name: DEFAULT_VIEW_NAME,
        configuration,
        isDefault: true,
      })
      .onConflictDoUpdate({
        target: [
          userTableViews.userId,
          userTableViews.tableKey,
          userTableViews.name,
        ],
        set: { configuration, updatedAt: new Date() },
      });
    return configuration;
  },
};
