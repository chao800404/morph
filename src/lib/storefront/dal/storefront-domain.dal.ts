import { getDb } from "@/db";
import { storefrontDomains, storefronts } from "@/db/storefront.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  type SQL,
} from "drizzle-orm";
import type { StorefrontDomainDTO } from "../dto/storefront-domain.dto";
import { toStorefrontDomainDTO } from "../mapper/storefront-domain.mapper";
import type { BatchItem } from "drizzle-orm/batch";

const activeStorefront = async () => {
  const db = await getDb();
  const [storefront] = await db
    .select({ id: storefronts.id })
    .from(storefronts)
    .where(isNull(storefronts.deletedAt))
    .orderBy(asc(storefronts.createdAt))
    .limit(1);
  return storefront ?? null;
};

export const storefrontDomainDal = {
  activeStorefront,
  async findById(id: string) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storefrontDomains)
      .where(
        and(eq(storefrontDomains.id, id), isNull(storefrontDomains.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  },
  async findByHostname(hostname: string) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storefrontDomains)
      .where(
        and(
          eq(storefrontDomains.hostname, hostname),
          isNull(storefrontDomains.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  },
  async listPage(options: {
    query?: string | null;
    sortBy: "hostname" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const storefront = await activeStorefront();
    if (!storefront) return { domains: [] as StorefrontDomainDTO[], total: 0 };
    const db = await getDb();
    const conditions: SQL[] = [
      eq(storefrontDomains.storefrontId, storefront.id),
      isNull(storefrontDomains.deletedAt),
    ];
    if (options.query?.trim())
      conditions.push(
        like(storefrontDomains.hostname, containsPattern(options.query.trim())),
      );
    const condition = and(...conditions);
    const column = {
      hostname: storefrontDomains.hostname,
      createdAt: storefrontDomains.createdAt,
      updatedAt: storefrontDomains.updatedAt,
    }[options.sortBy];
    const [counts, rows] = await Promise.all([
      db.select({ value: count() }).from(storefrontDomains).where(condition),
      db
        .select()
        .from(storefrontDomains)
        .where(condition)
        .orderBy(options.sortOrder === "asc" ? asc(column) : desc(column))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    return {
      domains: rows.map(toStorefrontDomainDTO),
      total: Number(counts[0]?.value ?? 0),
    };
  },
  async createPending(data: {
    id: string;
    storefrontId: string;
    hostname: string;
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(storefrontDomains).values({
      ...data,
      cloudflareDomainId: null,
      isPrimary: false,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
  async activate(
    id: string,
    storefrontId: string,
    hostname: string,
    cloudflareDomainId: string | null,
    makePrimary: boolean,
  ) {
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [];
    if (makePrimary) {
      statements.push(
        db
          .update(storefrontDomains)
          .set({ isPrimary: false, updatedAt: now })
          .where(
            and(
              eq(storefrontDomains.storefrontId, storefrontId),
              isNull(storefrontDomains.deletedAt),
            ),
          ),
      );
    }
    statements.push(
      db
        .update(storefrontDomains)
        .set({
          cloudflareDomainId,
          isPrimary: makePrimary,
          status: "active",
          errorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(storefrontDomains.id, id),
            isNull(storefrontDomains.deletedAt),
          ),
        ),
    );
    if (makePrimary) {
      statements.push(
        db
          .update(storefronts)
          .set({ domain: hostname, updatedAt: now })
          .where(eq(storefronts.id, storefrontId)),
      );
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
  async markFailed(id: string, message: string) {
    const db = await getDb();
    await db
      .update(storefrontDomains)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 500),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(storefrontDomains.id, id), isNull(storefrontDomains.deletedAt)),
      );
  },
  async setPrimary(id: string, storefrontId: string, hostname: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(storefrontDomains)
        .set({ isPrimary: false, updatedAt: now })
        .where(
          and(
            eq(storefrontDomains.storefrontId, storefrontId),
            isNull(storefrontDomains.deletedAt),
          ),
        ),
      db
        .update(storefrontDomains)
        .set({ isPrimary: true, updatedAt: now })
        .where(
          and(
            eq(storefrontDomains.id, id),
            eq(storefrontDomains.status, "active"),
            isNull(storefrontDomains.deletedAt),
          ),
        ),
      db
        .update(storefronts)
        .set({ domain: hostname, updatedAt: now })
        .where(eq(storefronts.id, storefrontId)),
    ]);
  },
  async softDelete(ids: string[]) {
    if (!ids.length) return;
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .update(storefrontDomains)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(storefrontDomains.id, ids));
  },
};
