import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { storefrontPageDal } from "@/lib/storefront/dal/storefront-page.dal";
import {
  createStorefrontPageInputSchema,
  getStorefrontPageInputSchema,
  listStorefrontPageRevisionsInputSchema,
  listStorefrontPagesInputSchema,
  updateStorefrontPageInputSchema,
  updateStorefrontPageMetadataInputSchema,
  restoreStorefrontPageRevisionInputSchema,
} from "@/lib/validations/storefront-page";
import { toHandle } from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listStorefrontPages = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listStorefrontPagesInputSchema.parse(data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await storefrontPageDal.listPage(data);
      return ok("Pages fetched", {
        pages: page.pages,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List storefront pages error",
        error,
        "LIST_FAILED",
        "Failed to fetch pages",
      );
    }
  });

export const getStorefrontPage = createServerFn({ method: "POST" })
  .validator((data: unknown) => getStorefrontPageInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const storefront = await storefrontPageDal.activeStorefront();
      if (!storefront)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const page = await storefrontPageDal.findDetail(data.id, storefront.id);
      return page
        ? ok("Page fetched", page)
        : fail("Page not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get storefront page error",
        error,
        "GET_FAILED",
        "Failed to fetch page",
      );
    }
  });

export const createStorefrontPage = createServerFn({ method: "POST" })
  .validator((data: unknown) => createStorefrontPageInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const storefront = await storefrontPageDal.activeStorefront();
      if (!storefront)
        return fail("Create an online storefront before adding pages", {
          error: "NOT_FOUND",
        });
      const parsedHandle = toHandle(data.handle, data.title);
      if (!parsedHandle.success)
        return fail("Enter a valid page handle", {
          errors: {
            handle: parsedHandle.error.issues.map((issue) => issue.message),
          },
        });
      if (
        await storefrontPageDal.handleExists(storefront.id, parsedHandle.data)
      )
        return fail("This page URL is already in use", {
          errors: { handle: ["Choose a unique handle"] },
        });
      const id = crypto.randomUUID();
      await storefrontPageDal.create({
        id,
        storefrontId: storefront.id,
        title: data.title,
        handle: parsedHandle.data,
        publish: data.publish,
        createdBy: context.user.id,
      });
      return ok("Page created", { id });
    } catch (error) {
      return failure(
        "Create storefront page error",
        error,
        "CREATE_FAILED",
        "Failed to create page",
      );
    }
  });

export const updateStorefrontPage = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateStorefrontPageInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const storefront = await storefrontPageDal.activeStorefront();
      if (!storefront)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const existing = await storefrontPageDal.findDetail(
        data.id,
        storefront.id,
      );
      if (!existing) return fail("Page not found", { error: "NOT_FOUND" });
      if (
        await storefrontPageDal.handleExists(
          storefront.id,
          data.handle,
          data.id,
        )
      )
        return fail("This page URL is already in use", {
          errors: { handle: ["Choose a unique handle"] },
        });
      const version = await storefrontPageDal.update({
        ...data,
        storefrontId: storefront.id,
        hasPublishedVersion: Boolean(existing.publishedRevisionId),
        createdBy: context.user.id,
      });
      return ok(data.publish ? "Page published" : "Draft saved", {
        id: data.id,
        version,
      });
    } catch (error) {
      return failure(
        "Update storefront page error",
        error,
        "UPDATE_FAILED",
        "Failed to update page",
      );
    }
  });

export const updateStorefrontPageMetadata = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    updateStorefrontPageMetadataInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const storefront = await storefrontPageDal.activeStorefront();
      if (!storefront)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const page = await storefrontPageDal.findDetail(data.id, storefront.id);
      if (!page) return fail("Page not found", { error: "NOT_FOUND" });
      await storefrontPageDal.updateMetadata(
        data.id,
        storefront.id,
        data.metadata,
      );
      return ok("Page metadata updated", { id: data.id });
    } catch (error) {
      return failure(
        "Update storefront page metadata error",
        error,
        "UPDATE_FAILED",
        "Failed to update page metadata",
      );
    }
  });

export const listStorefrontPageRevisions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listStorefrontPageRevisionsInputSchema.parse(data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const storefront = await storefrontPageDal.activeStorefront();
      if (!storefront)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const result = await storefrontPageDal.listRevisions(
        data.id,
        storefront.id,
        data.page,
        data.limit,
      );
      if (!result) return fail("Page not found", { error: "NOT_FOUND" });
      return ok("Page revisions fetched", {
        revisions: result.revisions,
        pagination: paginationOf(result.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List storefront page revisions error",
        error,
        "LIST_FAILED",
        "Failed to fetch page revisions",
      );
    }
  });

export const restoreStorefrontPageRevision = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    restoreStorefrontPageRevisionInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const storefront = await storefrontPageDal.activeStorefront();
      if (!storefront)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const restored = await storefrontPageDal.restoreRevision({
        ...data,
        storefrontId: storefront.id,
        createdBy: context.user.id,
      });
      return restored
        ? ok("Revision restored as a new draft", restored)
        : fail("Page revision not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Restore storefront page revision error",
        error,
        "RESTORE_FAILED",
        "Failed to restore page revision",
      );
    }
  });
