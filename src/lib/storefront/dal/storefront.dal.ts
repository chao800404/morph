import { getDb } from "@/db";
import {
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
  type StorefrontPageDocument,
} from "@/db/storefront.schema";
import { eq, isNull, and } from "drizzle-orm";
import type {
  StorefrontDTO,
  StorefrontPreferencesDTO,
} from "../dto/storefront.dto";
import { storefrontPreferencesSchema } from "@/lib/validations/storefront";
import {
  createDefaultStorefrontHomeDocument,
  isUpgradeableStarterHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";

export const DEFAULT_STOREFRONT_ID = "00000000-0000-4000-8000-000000000002";
export const DEFAULT_STOREFRONT_THEME_ID =
  "00000000-0000-4000-8000-000000000003";
const DEFAULT_HOME_TEMPLATE_ID = "00000000-0000-4000-8000-000000000004";
const DEFAULT_PRODUCT_TEMPLATE_ID = "00000000-0000-4000-8000-000000000005";
const INITIAL_SALES_CHANNEL_ID = "00000000-0000-4000-8000-000000000001";

const EMPTY_DOCUMENT: StorefrontPageDocument = { version: 1, sections: [] };

type StorefrontDb = Awaited<ReturnType<typeof getDb>>;

async function ensureStarterHomeDocument(
  db: StorefrontDb,
  themeId: string,
): Promise<void> {
  const [theme] = await db
    .select({ metadata: storefrontThemes.metadata })
    .from(storefrontThemes)
    .where(
      and(eq(storefrontThemes.id, themeId), isNull(storefrontThemes.deletedAt)),
    )
    .limit(1);
  if (!theme) return;

  const metadata = theme.metadata ?? {};
  const [homeTemplate] = await db
    .select({
      id: storefrontThemeTemplates.id,
      document: storefrontThemeTemplates.document,
    })
    .from(storefrontThemeTemplates)
    .where(
      and(
        eq(storefrontThemeTemplates.themeId, themeId),
        eq(storefrontThemeTemplates.type, "index"),
        isNull(storefrontThemeTemplates.deletedAt),
      ),
    )
    .limit(1);

  const [productTemplate] = await db
    .select({ id: storefrontThemeTemplates.id })
    .from(storefrontThemeTemplates)
    .where(
      and(
        eq(storefrontThemeTemplates.themeId, themeId),
        eq(storefrontThemeTemplates.type, "product"),
        isNull(storefrontThemeTemplates.deletedAt),
      ),
    )
    .limit(1);

  const now = new Date().toISOString();

  if (!homeTemplate) {
    await db.insert(storefrontThemeTemplates).values({
      id: crypto.randomUUID(),
      themeId,
      type: "index",
      name: "Default",
      document: createDefaultStorefrontHomeDocument(),
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!productTemplate) {
    await db.insert(storefrontThemeTemplates).values({
      id: crypto.randomUUID(),
      themeId,
      type: "product",
      name: "Default product",
      document: EMPTY_DOCUMENT,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (metadata.starterTemplateVersion === STOREFRONT_STARTER_TEMPLATE_VERSION) {
    return;
  }

  if (
    homeTemplate &&
    isUpgradeableStarterHomeDocument(homeTemplate.document)
  ) {
    await db
      .update(storefrontThemeTemplates)
      .set({
        document: createDefaultStorefrontHomeDocument(),
        updatedAt: now,
      })
      .where(eq(storefrontThemeTemplates.id, homeTemplate.id));
  }

  await db
    .update(storefrontThemes)
    .set({
      metadata: {
        ...metadata,
        starterTemplateVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
      },
      updatedAt: now,
    })
    .where(eq(storefrontThemes.id, themeId));
}

async function ensureStarterThemeWorkspace(
  storefrontId: string,
  themeId: string,
): Promise<void> {
  const existingFiles = await storefrontThemeFileDal.listFiles(
    storefrontId,
    themeId,
  );
  if (existingFiles.length === 0) {
    await storefrontThemeFileDal.initStarterTheme(storefrontId, themeId);
  }
}

/**
 * Creates the minimum editable website graph for a storefront channel.
 *
 * Every insert is idempotent because store initialization runs from several
 * reads. Existing themes and authored documents are never overwritten.
 */
export const storefrontDal = {
  async findActive(id?: string): Promise<StorefrontDTO | null> {
    const db = await getDb();
    const conditions = [isNull(storefronts.deletedAt)];
    if (id) conditions.push(eq(storefronts.id, id));
    const [row] = await db
      .select()
      .from(storefronts)
      .where(and(...conditions))
      .orderBy(storefronts.createdAt)
      .limit(1);
    if (!row) return null;
    const parsedPreferences = storefrontPreferencesSchema.safeParse(
      row.preferences ?? {},
    );
    return {
      id: row.id,
      salesChannelId: row.salesChannelId,
      name: row.name,
      domain: row.domain,
      status: row.status,
      activeThemeId: row.activeThemeId,
      activeReleaseId: row.activeReleaseId,
      preferences: parsedPreferences.success
        ? parsedPreferences.data
        : storefrontPreferencesSchema.parse({}),
    };
  },
  async updateWebsiteInformation(data: {
    id: string;
    name: string;
    preferences: StorefrontPreferencesDTO;
  }): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(storefronts)
      .set({
        name: data.name,
        preferences: data.preferences,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(storefronts.id, data.id), isNull(storefronts.deletedAt)));
    return Number(result.meta.changes ?? 0) > 0;
  },
  async updateAccess(data: {
    id: string;
    preferences: StorefrontPreferencesDTO;
  }): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(storefronts)
      .set({
        preferences: data.preferences,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(storefronts.id, data.id), isNull(storefronts.deletedAt)));
    return Number(result.meta.changes ?? 0) > 0;
  },
  async ensureDefault(salesChannelId: string): Promise<void> {
    const db = await getDb();
    const [existing] = await db
      .select({ id: storefronts.id, activeThemeId: storefronts.activeThemeId })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.salesChannelId, salesChannelId),
          isNull(storefronts.deletedAt),
        ),
      )
      .limit(1);

    if (existing?.activeThemeId) {
      await ensureStarterHomeDocument(db, existing.activeThemeId);
      await ensureStarterThemeWorkspace(existing.id, existing.activeThemeId);
      return;
    }

    const now = new Date().toISOString();
    const isInitialStorefront = salesChannelId === INITIAL_SALES_CHANNEL_ID;
    const storefrontId =
      existing?.id ??
      (isInitialStorefront ? DEFAULT_STOREFRONT_ID : crypto.randomUUID());
    const themeId = isInitialStorefront
      ? DEFAULT_STOREFRONT_THEME_ID
      : crypto.randomUUID();
    const homeTemplateId = isInitialStorefront
      ? DEFAULT_HOME_TEMPLATE_ID
      : crypto.randomUUID();
    const productTemplateId = isInitialStorefront
      ? DEFAULT_PRODUCT_TEMPLATE_ID
      : crypto.randomUUID();
    await db
      .insert(storefronts)
      .values({
        id: storefrontId,
        salesChannelId,
        name: "Online Store",
        status: "published",
        preferences: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .insert(storefrontThemes)
      .values({
        id: themeId,
        storefrontId,
        name: "Default",
        status: "published",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .insert(storefrontThemeTemplates)
      .values([
        {
          id: homeTemplateId,
          themeId,
          type: "index",
          name: "Default",
          document: createDefaultStorefrontHomeDocument(),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: productTemplateId,
          themeId,
          type: "product",
          name: "Default product",
          document: EMPTY_DOCUMENT,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .onConflictDoNothing();

    await db
      .update(storefronts)
      .set({ activeThemeId: themeId, updatedAt: now })
      .where(eq(storefronts.id, storefrontId));

    await ensureStarterHomeDocument(db, themeId);
    await ensureStarterThemeWorkspace(storefrontId, themeId);
  },
};
