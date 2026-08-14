import { getDb } from "@/db";
import {
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
} from "@/db/storefront.schema";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import { and, asc, eq, isNull } from "drizzle-orm";

export const storefrontThemeDal = {
  async findEditorContext(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeEditorDTO | null> {
    const db = await getDb();
    const [context] = await db
      .select({
        storefrontId: storefronts.id,
        storefrontName: storefronts.name,
        storefrontDomain: storefronts.domain,
        storefrontStatus: storefronts.status,
        themeId: storefrontThemes.id,
        themeName: storefrontThemes.name,
        themeStatus: storefrontThemes.status,
      })
      .from(storefrontThemes)
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, storefrontId),
          eq(storefrontThemes.id, themeId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);

    if (!context) return null;

    const templateRows = await db
      .select({
        id: storefrontThemeTemplates.id,
        type: storefrontThemeTemplates.type,
        name: storefrontThemeTemplates.name,
        document: storefrontThemeTemplates.document,
      })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, themeId),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .orderBy(
        asc(storefrontThemeTemplates.type),
        asc(storefrontThemeTemplates.name),
      );

    const templates = templateRows.map((template) => ({
      ...template,
      document: storefrontPageDocumentSchema.parse(template.document),
    }));

    return {
      storefront: {
        id: context.storefrontId,
        name: context.storefrontName,
        domain: context.storefrontDomain,
        status: context.storefrontStatus,
      },
      theme: {
        id: context.themeId,
        name: context.themeName,
        status: context.themeStatus,
      },
      templates,
    };
  },
};
