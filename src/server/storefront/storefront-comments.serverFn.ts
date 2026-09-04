import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { storefrontCommentDal } from "@/lib/storefront/dal/storefront-comment.dal";
import {
  createStorefrontCommentGroupInputSchema,
  createStorefrontCommentThreadInputSchema,
  deleteStorefrontCommentGroupInputSchema,
  deleteStorefrontCommentInputSchema,
  deleteStorefrontCommentThreadInputSchema,
  listStorefrontCommentGroupsInputSchema,
  listStorefrontCommentThreadsInputSchema,
  replyStorefrontCommentInputSchema,
  resolveStorefrontCommentThreadInputSchema,
  updateStorefrontCommentGroupInputSchema,
  updateStorefrontCommentThreadPositionInputSchema,
} from "@/lib/validations/storefront-comment";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const createStorefrontCommentGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createStorefrontCommentGroupInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.createGroup({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Comment group created", result)
        : fail("Failed to create comment group", {
            error: "CREATE_FAILED",
          });
    } catch (error) {
      return failure(
        "Create comment group error",
        error,
        "CREATE_FAILED",
        "Failed to create comment group",
      );
    }
  });

export const updateStorefrontCommentGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateStorefrontCommentGroupInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.updateGroup(data);
      return result
        ? ok("Comment group updated", result)
        : fail("Comment group not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Update comment group error",
        error,
        "UPDATE_FAILED",
        "Failed to update comment group",
      );
    }
  });

export const deleteStorefrontCommentGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteStorefrontCommentGroupInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const success = await storefrontCommentDal.deleteGroup(data);
      return success
        ? ok("Comment group deleted", { success: true })
        : fail("Comment group not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Delete comment group error",
        error,
        "DELETE_FAILED",
        "Failed to delete comment group",
      );
    }
  });

export const clearStorefrontCommentGroupResolved = createServerFn({
  method: "POST",
})
  .validator((data: unknown) => parseInput(deleteStorefrontCommentGroupInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const success = await storefrontCommentDal.clearGroupResolvedThreads(data);
      return success
        ? ok("Resolved comments cleared", { success: true })
        : fail("Comment group not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Clear resolved comments error",
        error,
        "CLEAR_FAILED",
        "Failed to clear resolved comments",
      );
    }
  });

export const listStorefrontCommentGroups = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listStorefrontCommentGroupsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.listGroups(data);
      return ok("Comment groups fetched", result);
    } catch (error) {
      return failure(
        "List comment groups error",
        error,
        "GET_FAILED",
        "Failed to list comment groups",
      );
    }
  });

export const updateStorefrontCommentThreadPosition = createServerFn({
  method: "POST",
})
  .validator((data: unknown) => parseInput(updateStorefrontCommentThreadPositionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result =
        await storefrontCommentDal.updateThreadPosition(data);
      return result
        ? ok("Comment position updated", result)
        : fail("Failed to update comment position", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Update comment position error",
        error,
        "UPDATE_FAILED",
        "Failed to update comment position",
      );
    }
  });

export const createStorefrontCommentThread = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createStorefrontCommentThreadInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.createThread({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Comment thread created", result)
        : fail("Failed to create comment thread: template not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Create comment thread error",
        error,
        "CREATE_FAILED",
        "Failed to create comment thread",
      );
    }
  });

export const replyStorefrontComment = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(replyStorefrontCommentInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.replyComment({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Comment reply added", result)
        : fail("Comment thread not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Reply comment error",
        error,
        "CREATE_FAILED",
        "Failed to add comment reply",
      );
    }
  });

export const resolveStorefrontCommentThread = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(resolveStorefrontCommentThreadInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.resolveThread({
        ...data,
        resolvedBy: context.user.id,
      });
      return result
        ? ok(
            data.resolved
              ? "Comment thread resolved"
              : "Comment thread reopened",
            result,
          )
        : fail("Comment thread not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Resolve comment thread error",
        error,
        "UPDATE_FAILED",
        "Failed to update comment thread status",
      );
    }
  });

export const deleteStorefrontCommentThread = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteStorefrontCommentThreadInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const success = await storefrontCommentDal.deleteThread(data);
      return success
        ? ok("Comment thread deleted", { success: true })
        : fail("Comment thread not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Delete comment thread error",
        error,
        "DELETE_FAILED",
        "Failed to delete comment thread",
      );
    }
  });

export const deleteStorefrontComment = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteStorefrontCommentInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const success = await storefrontCommentDal.deleteComment({
        ...data,
        userId: context.user.id,
      });
      return success
        ? ok("Comment deleted", { success: true })
        : fail("Comment not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Delete comment error",
        error,
        "DELETE_FAILED",
        "Failed to delete comment",
      );
    }
  });

export const listStorefrontCommentThreads = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listStorefrontCommentThreadsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await storefrontCommentDal.listThreads(data);
      return ok("Comment threads fetched", result);
    } catch (error) {
      return failure(
        "List comment threads error",
        error,
        "GET_FAILED",
        "Failed to list comment threads",
      );
    }
  });
