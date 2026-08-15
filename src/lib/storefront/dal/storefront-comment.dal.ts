import { getDb } from "@/db";
import {
  storefrontCommentGroups,
  storefrontComments,
  storefrontCommentThreads,
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
} from "@/db/storefront.schema";
import { users } from "@/db/auth.schema";
import { chunk } from "@/lib/product/dal/d1-batch";
import type {
  StorefrontCommentAuthorDTO,
  StorefrontCommentDTO,
  StorefrontCommentGroupDTO,
  StorefrontCommentThreadDTO,
} from "../dto/storefront-comment.dto";
import type {
  CreateStorefrontCommentGroupInput,
  CreateStorefrontCommentThreadInput,
  DeleteStorefrontCommentGroupInput,
  DeleteStorefrontCommentInput,
  DeleteStorefrontCommentThreadInput,
  ListStorefrontCommentGroupsInput,
  ListStorefrontCommentThreadsInput,
  ReplyStorefrontCommentInput,
  ResolveStorefrontCommentThreadInput,
  UpdateStorefrontCommentGroupInput,
  UpdateStorefrontCommentThreadPositionInput,
} from "@/lib/validations/storefront-comment";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

function toAuthorDTO(user?: {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  image?: string | null;
} | null): StorefrontCommentAuthorDTO {
  return {
    id: user?.id ?? "unknown",
    name: user?.name?.trim() || "Anonymous",
    email: user?.email ?? "",
    image: user?.image ?? null,
  };
}

export const storefrontCommentDal = {
  // --- Groups CRUD ---

  async findGroupById(
    groupId: string,
  ): Promise<StorefrontCommentGroupDTO | null> {
    const db = await getDb();
    const [groupRow] = await db
      .select({
        id: storefrontCommentGroups.id,
        storefrontId: storefrontCommentGroups.storefrontId,
        themeId: storefrontCommentGroups.themeId,
        templateId: storefrontCommentGroups.templateId,
        name: storefrontCommentGroups.name,
        viewportWidth: storefrontCommentGroups.viewportWidth,
        createdBy: storefrontCommentGroups.createdBy,
        createdAt: storefrontCommentGroups.createdAt,
        updatedAt: storefrontCommentGroups.updatedAt,
      })
      .from(storefrontCommentGroups)
      .where(
        and(
          eq(storefrontCommentGroups.id, groupId),
          isNull(storefrontCommentGroups.deletedAt),
        ),
      )
      .limit(1);

    if (!groupRow) return null;

    return {
      id: groupRow.id,
      storefrontId: groupRow.storefrontId,
      themeId: groupRow.themeId,
      templateId: groupRow.templateId,
      name: groupRow.name,
      viewportWidth: groupRow.viewportWidth,
      createdBy: groupRow.createdBy,
      createdAt: groupRow.createdAt,
      updatedAt: groupRow.updatedAt,
    };
  },

  async createGroup(
    input: CreateStorefrontCommentGroupInput & { createdBy: string },
  ): Promise<StorefrontCommentGroupDTO | null> {
    const db = await getDb();
    const [targetTemplate] = await db
      .select({ id: storefrontThemeTemplates.id })
      .from(storefrontThemeTemplates)
      .innerJoin(
        storefrontThemes,
        eq(storefrontThemeTemplates.themeId, storefrontThemes.id),
      )
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, input.storefrontId),
          eq(storefrontThemes.id, input.themeId),
          eq(storefrontThemeTemplates.id, input.templateId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (!targetTemplate) return null;

    const groupId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(storefrontCommentGroups).values({
      id: groupId,
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      templateId: input.templateId,
      name: input.name,
      viewportWidth: input.viewportWidth ?? 1440,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: groupId,
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      templateId: input.templateId,
      name: input.name,
      viewportWidth: input.viewportWidth ?? 1440,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      threadCount: 0,
      openCount: 0,
      resolvedCount: 0,
    };
  },

  async updateGroup(
    input: UpdateStorefrontCommentGroupInput,
  ): Promise<StorefrontCommentGroupDTO | null> {
    const db = await getDb();
    const now = new Date().toISOString();

    const updateData: {
      name?: string;
      viewportWidth?: number;
      updatedAt: string;
    } = {
      updatedAt: now,
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.viewportWidth !== undefined) {
      updateData.viewportWidth = input.viewportWidth;
    }

    await db
      .update(storefrontCommentGroups)
      .set(updateData)
      .where(
        and(
          eq(storefrontCommentGroups.id, input.groupId),
          eq(storefrontCommentGroups.storefrontId, input.storefrontId),
          eq(storefrontCommentGroups.themeId, input.themeId),
          isNull(storefrontCommentGroups.deletedAt),
        ),
      );

    return this.findGroupById(input.groupId);
  },

  async deleteGroup(
    input: DeleteStorefrontCommentGroupInput,
  ): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();

    // Soft delete group
    await db
      .update(storefrontCommentGroups)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storefrontCommentGroups.id, input.groupId),
          eq(storefrontCommentGroups.storefrontId, input.storefrontId),
          eq(storefrontCommentGroups.themeId, input.themeId),
          isNull(storefrontCommentGroups.deletedAt),
        ),
      );

    // Soft delete associated threads
    await db
      .update(storefrontCommentThreads)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storefrontCommentThreads.groupId, input.groupId),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      );

    return true;
  },

  async clearGroupResolvedThreads(input: {
    storefrontId: string;
    themeId: string;
    groupId: string;
  }): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();

    // Check if there are any open threads remaining in this group
    const [openThread] = await db
      .select({ id: storefrontCommentThreads.id })
      .from(storefrontCommentThreads)
      .where(
        and(
          eq(storefrontCommentThreads.groupId, input.groupId),
          eq(storefrontCommentThreads.status, "open"),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      )
      .limit(1);

    // Soft delete all resolved threads in this group
    await db
      .update(storefrontCommentThreads)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storefrontCommentThreads.groupId, input.groupId),
          eq(storefrontCommentThreads.status, "resolved"),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      );

    // If there were NO open threads in this group, delete the group as well
    if (!openThread) {
      await db
        .update(storefrontCommentGroups)
        .set({ deletedAt: now })
        .where(
          and(
            eq(storefrontCommentGroups.id, input.groupId),
            eq(storefrontCommentGroups.storefrontId, input.storefrontId),
            eq(storefrontCommentGroups.themeId, input.themeId),
            isNull(storefrontCommentGroups.deletedAt),
          ),
        );
    }

    return true;
  },

  async listGroups(
    input: ListStorefrontCommentGroupsInput,
  ): Promise<StorefrontCommentGroupDTO[]> {
    const db = await getDb();
    const groupRows = await db
      .select({
        id: storefrontCommentGroups.id,
        storefrontId: storefrontCommentGroups.storefrontId,
        themeId: storefrontCommentGroups.themeId,
        templateId: storefrontCommentGroups.templateId,
        name: storefrontCommentGroups.name,
        viewportWidth: storefrontCommentGroups.viewportWidth,
        createdBy: storefrontCommentGroups.createdBy,
        createdAt: storefrontCommentGroups.createdAt,
        updatedAt: storefrontCommentGroups.updatedAt,
      })
      .from(storefrontCommentGroups)
      .where(
        and(
          eq(storefrontCommentGroups.storefrontId, input.storefrontId),
          eq(storefrontCommentGroups.themeId, input.themeId),
          eq(storefrontCommentGroups.templateId, input.templateId),
          isNull(storefrontCommentGroups.deletedAt),
        ),
      )
      .orderBy(asc(storefrontCommentGroups.createdAt));

    if (groupRows.length === 0) return [];

    // Fetch threads to calculate threadCount, openCount, resolvedCount
    const groupIds = groupRows.map((g) => g.id);
    const threads = await db
      .select({
        id: storefrontCommentThreads.id,
        groupId: storefrontCommentThreads.groupId,
        status: storefrontCommentThreads.status,
      })
      .from(storefrontCommentThreads)
      .where(
        and(
          inArray(storefrontCommentThreads.groupId, groupIds),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      );

    const statsByGroup = new Map<
      string,
      { total: number; open: number; resolved: number }
    >();
    for (const t of threads) {
      if (!t.groupId) continue;
      const stats = statsByGroup.get(t.groupId) ?? {
        total: 0,
        open: 0,
        resolved: 0,
      };
      stats.total += 1;
      if (t.status === "open") stats.open += 1;
      if (t.status === "resolved") stats.resolved += 1;
      statsByGroup.set(t.groupId, stats);
    }

    return groupRows.map((g) => {
      const stats = statsByGroup.get(g.id) ?? {
        total: 0,
        open: 0,
        resolved: 0,
      };
      return {
        id: g.id,
        storefrontId: g.storefrontId,
        themeId: g.themeId,
        templateId: g.templateId,
        name: g.name,
        viewportWidth: g.viewportWidth,
        createdBy: g.createdBy,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        threadCount: stats.total,
        openCount: stats.open,
        resolvedCount: stats.resolved,
      };
    });
  },

  // --- Threads CRUD ---

  async findThreadById(
    threadId: string,
  ): Promise<StorefrontCommentThreadDTO | null> {
    const db = await getDb();
    const [threadRow] = await db
      .select({
        id: storefrontCommentThreads.id,
        storefrontId: storefrontCommentThreads.storefrontId,
        themeId: storefrontCommentThreads.themeId,
        templateId: storefrontCommentThreads.templateId,
        groupId: storefrontCommentThreads.groupId,
        sectionId: storefrontCommentThreads.sectionId,
        elementKey: storefrontCommentThreads.elementKey,
        viewportWidth: storefrontCommentThreads.viewportWidth,
        viewport: storefrontCommentThreads.viewport,
        positionX: storefrontCommentThreads.positionX,
        positionY: storefrontCommentThreads.positionY,
        status: storefrontCommentThreads.status,
        resolvedAt: storefrontCommentThreads.resolvedAt,
        resolvedBy: storefrontCommentThreads.resolvedBy,
        createdBy: storefrontCommentThreads.createdBy,
        createdAt: storefrontCommentThreads.createdAt,
        updatedAt: storefrontCommentThreads.updatedAt,
        authorName: users.name,
        authorEmail: users.email,
        authorImage: users.image,
      })
      .from(storefrontCommentThreads)
      .leftJoin(users, eq(storefrontCommentThreads.createdBy, users.id))
      .where(
        and(
          eq(storefrontCommentThreads.id, threadId),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      )
      .limit(1);

    if (!threadRow) return null;

    const commentRows = await db
      .select({
        id: storefrontComments.id,
        threadId: storefrontComments.threadId,
        createdBy: storefrontComments.createdBy,
        content: storefrontComments.content,
        createdAt: storefrontComments.createdAt,
        updatedAt: storefrontComments.updatedAt,
        authorName: users.name,
        authorEmail: users.email,
        authorImage: users.image,
      })
      .from(storefrontComments)
      .leftJoin(users, eq(storefrontComments.createdBy, users.id))
      .where(
        and(
          eq(storefrontComments.threadId, threadId),
          isNull(storefrontComments.deletedAt),
        ),
      )
      .orderBy(asc(storefrontComments.createdAt));

    const comments: StorefrontCommentDTO[] = commentRows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      content: row.content,
      createdBy: row.createdBy,
      authorId: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: toAuthorDTO({
        id: row.createdBy,
        name: row.authorName ?? "Anonymous",
        email: row.authorEmail ?? "",
        image: row.authorImage ?? null,
      }),
    }));

    return {
      id: threadRow.id,
      storefrontId: threadRow.storefrontId,
      themeId: threadRow.themeId,
      templateId: threadRow.templateId,
      groupId: threadRow.groupId,
      sectionId: threadRow.sectionId,
      elementKey: threadRow.elementKey,
      viewportWidth: threadRow.viewportWidth ?? 1440,
      viewport: threadRow.viewport ?? "desktop",
      positionX: threadRow.positionX,
      positionY: threadRow.positionY,
      status: threadRow.status,
      resolvedAt: threadRow.resolvedAt,
      resolvedBy: threadRow.resolvedBy,
      createdBy: threadRow.createdBy,
      authorId: threadRow.createdBy,
      createdAt: threadRow.createdAt,
      updatedAt: threadRow.updatedAt,
      author: toAuthorDTO({
        id: threadRow.createdBy,
        name: threadRow.authorName ?? "Anonymous",
        email: threadRow.authorEmail ?? "",
        image: threadRow.authorImage ?? null,
      }),
      comments,
    };
  },

  async createThread(
    input: CreateStorefrontCommentThreadInput & { createdBy: string },
  ): Promise<StorefrontCommentThreadDTO | null> {
    const db = await getDb();
    const [targetTemplate] = await db
      .select({ id: storefrontThemeTemplates.id })
      .from(storefrontThemeTemplates)
      .innerJoin(
        storefrontThemes,
        eq(storefrontThemeTemplates.themeId, storefrontThemes.id),
      )
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, input.storefrontId),
          eq(storefrontThemes.id, input.themeId),
          eq(storefrontThemeTemplates.id, input.templateId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (!targetTemplate) return null;

    let targetGroupId = input.groupId ?? null;
    if (!targetGroupId) {
      const existingGroups = await this.listGroups({
        storefrontId: input.storefrontId,
        themeId: input.themeId,
        templateId: input.templateId,
      });

      if (existingGroups.length > 0) {
        targetGroupId = existingGroups[0].id;
      } else {
        const newGroup = await this.createGroup({
          storefrontId: input.storefrontId,
          themeId: input.themeId,
          templateId: input.templateId,
          name: "Group 1",
          viewportWidth: input.viewportWidth ?? 1440,
          createdBy: input.createdBy,
        });
        targetGroupId = newGroup?.id ?? null;
      }
    }

    const threadId = crypto.randomUUID();
    const commentId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(storefrontCommentThreads).values({
      id: threadId,
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      templateId: input.templateId,
      groupId: targetGroupId,
      sectionId: input.sectionId ?? null,
      elementKey: input.elementKey ?? null,
      viewportWidth: input.viewportWidth ?? 1440,
      viewport: input.viewport ?? "desktop",
      positionX: input.positionX,
      positionY: input.positionY,
      status: "open",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(storefrontComments).values({
      id: commentId,
      threadId,
      createdBy: input.createdBy,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    });

    return this.findThreadById(threadId);
  },

  async replyComment(
    input: ReplyStorefrontCommentInput & { createdBy: string },
  ): Promise<StorefrontCommentDTO | null> {
    const db = await getDb();
    const [thread] = await db
      .select({
        id: storefrontCommentThreads.id,
      })
      .from(storefrontCommentThreads)
      .where(
        and(
          eq(storefrontCommentThreads.id, input.threadId),
          eq(storefrontCommentThreads.storefrontId, input.storefrontId),
          eq(storefrontCommentThreads.themeId, input.themeId),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      )
      .limit(1);

    if (!thread) return null;

    const commentId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(storefrontComments).values({
      id: commentId,
      threadId: input.threadId,
      createdBy: input.createdBy,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(storefrontCommentThreads)
      .set({ updatedAt: now })
      .where(eq(storefrontCommentThreads.id, input.threadId));

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(eq(users.id, input.createdBy))
      .limit(1);

    return {
      id: commentId,
      threadId: input.threadId,
      content: input.content,
      createdBy: input.createdBy,
      authorId: input.createdBy,
      createdAt: now,
      updatedAt: now,
      author: toAuthorDTO(user),
    };
  },

  async resolveThread(
    input: ResolveStorefrontCommentThreadInput & { resolvedBy: string },
  ): Promise<StorefrontCommentThreadDTO | null> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .update(storefrontCommentThreads)
      .set({
        status: input.resolved ? "resolved" : "open",
        resolvedAt: input.resolved ? now : null,
        resolvedBy: input.resolved ? input.resolvedBy : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontCommentThreads.id, input.threadId),
          eq(storefrontCommentThreads.storefrontId, input.storefrontId),
          eq(storefrontCommentThreads.themeId, input.themeId),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      );

    return this.findThreadById(input.threadId);
  },

  async updateThreadPosition(
    input: UpdateStorefrontCommentThreadPositionInput,
  ): Promise<StorefrontCommentThreadDTO | null> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .update(storefrontCommentThreads)
      .set({
        positionX: input.positionX,
        positionY: input.positionY,
        sectionId: input.sectionId ?? null,
        elementKey: input.elementKey ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontCommentThreads.id, input.threadId),
          eq(storefrontCommentThreads.storefrontId, input.storefrontId),
          eq(storefrontCommentThreads.themeId, input.themeId),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      );

    return this.findThreadById(input.threadId);
  },

  async deleteThread(
    input: DeleteStorefrontCommentThreadInput,
  ): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .update(storefrontCommentThreads)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storefrontCommentThreads.id, input.threadId),
          eq(storefrontCommentThreads.storefrontId, input.storefrontId),
          eq(storefrontCommentThreads.themeId, input.themeId),
          isNull(storefrontCommentThreads.deletedAt),
        ),
      );

    await db
      .update(storefrontComments)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storefrontComments.threadId, input.threadId),
          isNull(storefrontComments.deletedAt),
        ),
      );

    return true;
  },

  async deleteComment(
    input: DeleteStorefrontCommentInput & { userId: string },
  ): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .update(storefrontComments)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storefrontComments.id, input.commentId),
          eq(storefrontComments.createdBy, input.userId),
          isNull(storefrontComments.deletedAt),
        ),
      );

    return true;
  },

  async listThreads(
    input: ListStorefrontCommentThreadsInput,
  ): Promise<StorefrontCommentThreadDTO[]> {
    const db = await getDb();

    const conditions = [
      eq(storefrontCommentThreads.storefrontId, input.storefrontId),
      eq(storefrontCommentThreads.themeId, input.themeId),
      eq(storefrontCommentThreads.templateId, input.templateId),
      isNull(storefrontCommentThreads.deletedAt),
    ];

    if (input.groupId) {
      conditions.push(eq(storefrontCommentThreads.groupId, input.groupId));
    }

    if (input.status === "open") {
      conditions.push(eq(storefrontCommentThreads.status, "open"));
    } else if (input.status === "resolved") {
      conditions.push(eq(storefrontCommentThreads.status, "resolved"));
    }

    const threadRows = await db
      .select({
        id: storefrontCommentThreads.id,
        storefrontId: storefrontCommentThreads.storefrontId,
        themeId: storefrontCommentThreads.themeId,
        templateId: storefrontCommentThreads.templateId,
        groupId: storefrontCommentThreads.groupId,
        sectionId: storefrontCommentThreads.sectionId,
        elementKey: storefrontCommentThreads.elementKey,
        viewportWidth: storefrontCommentThreads.viewportWidth,
        viewport: storefrontCommentThreads.viewport,
        positionX: storefrontCommentThreads.positionX,
        positionY: storefrontCommentThreads.positionY,
        status: storefrontCommentThreads.status,
        resolvedAt: storefrontCommentThreads.resolvedAt,
        resolvedBy: storefrontCommentThreads.resolvedBy,
        createdBy: storefrontCommentThreads.createdBy,
        createdAt: storefrontCommentThreads.createdAt,
        updatedAt: storefrontCommentThreads.updatedAt,
        authorName: users.name,
        authorEmail: users.email,
        authorImage: users.image,
      })
      .from(storefrontCommentThreads)
      .leftJoin(users, eq(storefrontCommentThreads.createdBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(storefrontCommentThreads.createdAt));

    if (threadRows.length === 0) return [];

    const threadIds: string[] = threadRows.map((t) => t.id);
    const commentRows: Array<{
      id: string;
      threadId: string;
      createdBy: string;
      content: string;
      createdAt: string;
      updatedAt: string;
      authorName: string | null;
      authorEmail: string | null;
      authorImage: string | null;
    }> = [];

    const chunks = chunk<string>(threadIds, 50);
    for (const group of chunks) {
      const rows = await db
        .select({
          id: storefrontComments.id,
          threadId: storefrontComments.threadId,
          createdBy: storefrontComments.createdBy,
          content: storefrontComments.content,
          createdAt: storefrontComments.createdAt,
          updatedAt: storefrontComments.updatedAt,
          authorName: users.name,
          authorEmail: users.email,
          authorImage: users.image,
        })
        .from(storefrontComments)
        .leftJoin(users, eq(storefrontComments.createdBy, users.id))
        .where(
          and(
            inArray(storefrontComments.threadId, group),
            isNull(storefrontComments.deletedAt),
          ),
        )
        .orderBy(asc(storefrontComments.createdAt));

      commentRows.push(...rows);
    }

    const commentsByThread = new Map<string, StorefrontCommentDTO[]>();
    for (const row of commentRows) {
      const list = commentsByThread.get(row.threadId) ?? [];
      list.push({
        id: row.id,
        threadId: row.threadId,
        content: row.content,
        createdBy: row.createdBy,
        authorId: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        author: toAuthorDTO({
          id: row.createdBy,
          name: row.authorName ?? "Anonymous",
          email: row.authorEmail ?? "",
          image: row.authorImage ?? null,
        }),
      });
      commentsByThread.set(row.threadId, list);
    }

    return threadRows.map((thread) => ({
      id: thread.id,
      storefrontId: thread.storefrontId,
      themeId: thread.themeId,
      templateId: thread.templateId,
      groupId: thread.groupId,
      sectionId: thread.sectionId,
      elementKey: thread.elementKey,
      viewportWidth: thread.viewportWidth ?? 1440,
      viewport: thread.viewport ?? "desktop",
      positionX: thread.positionX,
      positionY: thread.positionY,
      status: thread.status,
      resolvedAt: thread.resolvedAt,
      resolvedBy: thread.resolvedBy,
      createdBy: thread.createdBy,
      authorId: thread.createdBy,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      author: toAuthorDTO({
        id: thread.createdBy,
        name: thread.authorName ?? "Anonymous",
        email: thread.authorEmail ?? "",
        image: thread.authorImage ?? null,
      }),
      comments: commentsByThread.get(thread.id) ?? [],
    }));
  },
};
