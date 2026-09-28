import type { ReservationDTO } from "@/lib/inventory/dto/reservation.dto";
import type { AdminApiAccess } from "./orders";
import type {
  CreateManualReservationInput,
  UpdateManualReservationInput,
} from "@/lib/inventory/service/reservation-write.service";
import { metadataInputSchema } from "@/lib/validations/product";
import { z } from "zod";

export type AdminReservationsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listReservations(input: {
    query?: string;
    inventoryItemId?: string;
    locationId?: string;
    sortBy: "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ reservations: ReservationDTO[]; total: number }>;
  findReservation(id: string): Promise<ReservationDTO | null>;
  createReservation(
    input: Omit<CreateManualReservationInput, "createdBy">,
    actorId: string,
  ): Promise<
    { success: true; id: string } | { success: false; reason: string }
  >;
  updateReservation(
    input: UpdateManualReservationInput,
  ): Promise<
    { success: true; id: string } | { success: false; reason: string }
  >;
  deleteReservation(
    id: string,
  ): Promise<"deleted" | "not-found" | "not-manual" | "no-level" | "conflict">;
};

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const createBodySchema = z
  .object({
    inventory_item_id: z.uuid(),
    location_id: z.uuid(),
    quantity: z.number().finite().gt(0).max(1_000_000_000),
    allow_backorder: z.boolean().default(false),
    description: nullableText(2000),
    external_id: nullableText(200),
    metadata: metadataInputSchema.optional(),
  })
  .strict();

const updateBodySchema = z
  .object({
    quantity: z.number().finite().gt(0).max(1_000_000_000).optional(),
    allow_backorder: z.boolean().optional(),
    description: nullableText(2000),
    external_id: nullableText(200),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined));

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    inventory_item_id: z.uuid().optional(),
    location_id: z.uuid().optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum(["created_at", "-created_at", "updated_at", "-updated_at"])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    inventoryItemId: input.inventory_item_id,
    locationId: input.location_id,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const errorResponse = (error: string, message: string, status: number) =>
  json({ error, message }, status);

const itemToApi = (reservation: ReservationDTO) => ({
  id: reservation.id,
  inventory_item_id: reservation.inventoryItemId,
  location_id: reservation.locationId,
  quantity: reservation.quantity,
  allow_backorder: reservation.allowBackorder,
  description: reservation.description,
  external_id: reservation.externalId,
  line_item_id: reservation.lineItemId,
  created_by: reservation.createdBy,
  expires_at: reservation.expiresAt,
  metadata: reservation.metadata,
  inventory_item: {
    id: reservation.inventoryItemId,
    title: reservation.inventoryItemTitle,
    sku: reservation.inventoryItemSku,
    unit_of_measure: reservation.inventoryItemUnitOfMeasure,
  },
  location: reservation.locationName
    ? { id: reservation.locationId, name: reservation.locationName }
    : null,
  created_at: reservation.createdAt,
  updated_at: reservation.updatedAt,
});

const fromApiFields = (input: z.infer<typeof updateBodySchema>) => ({
  ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
  ...(input.allow_backorder !== undefined
    ? { allowBackorder: input.allow_backorder }
    : {}),
  ...(input.description !== undefined
    ? { description: input.description }
    : {}),
  ...(input.external_id !== undefined ? { externalId: input.external_id } : {}),
  ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
});

const writeError = (reason: string) => {
  const errors: Record<string, { status: number; message: string }> = {
    NOT_FOUND: { status: 404, message: "Reservation not found" },
    NOT_MANUAL: {
      status: 409,
      message:
        "Cart and order reservations are managed by their commerce workflow",
    },
    INVALID_LOCATION: { status: 400, message: "Stock location is unavailable" },
    NO_LOCATION_LEVEL: {
      status: 409,
      message: "Create an inventory level for this item and location first",
    },
    INSUFFICIENT_STOCK: {
      status: 409,
      message: "There is not enough available stock for this reservation",
    },
    CONFLICT: {
      status: 409,
      message: "Inventory changed while the reservation was being edited",
    },
  };
  const result = errors[reason] ?? {
    status: 500,
    message: "Reservation operation failed",
  };
  return errorResponse(reason, result.message, result.status);
};

const bodyJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const methodNotAllowed = (allow: string) =>
  new Response(
    JSON.stringify({
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed",
    }),
    {
      status: 405,
      headers: {
        allow,
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    },
  );

export async function handleAdminReservationsRequest(
  request: Request,
  dependencies: AdminReservationsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    access = {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!access.allowed)
    return errorResponse(access.error, access.message, access.status);
  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");
  const requireAdmin = () =>
    access.userId && access.role === "admin"
      ? null
      : errorResponse("FORBIDDEN", "Administrator access is required", 403);

  if (path === "reservations") {
    if (request.method === "GET") {
      const query = listQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!query.success) {
        return json(
          {
            error: "INVALID_REQUEST",
            message: "Invalid reservation query",
            details: query.error.flatten().fieldErrors,
          },
          400,
        );
      }
      try {
        const result = await dependencies.listReservations(query.data);
        return json({
          reservations: result.reservations.map(itemToApi),
          count: result.total,
          offset: query.data.offset,
          limit: query.data.limit,
        });
      } catch {
        return errorResponse(
          "INTERNAL_ERROR",
          "Reservations could not be loaded",
          500,
        );
      }
    }
    if (request.method === "POST") {
      const forbidden = requireAdmin();
      if (forbidden) return forbidden;
      const parsed = createBodySchema.safeParse(await bodyJson(request));
      if (!parsed.success) {
        return json(
          {
            error: "INVALID_REQUEST",
            message: "Invalid reservation request",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      if (!access.userId)
        return errorResponse(
          "FORBIDDEN",
          "Administrator identity is unavailable",
          403,
        );
      try {
        const {
          inventory_item_id,
          location_id,
          allow_backorder,
          external_id,
          ...fields
        } = parsed.data;
        const result = await dependencies.createReservation(
          {
            inventoryItemId: inventory_item_id,
            locationId: location_id,
            ...fields,
            allowBackorder: allow_backorder,
            externalId: external_id ?? null,
            metadata: parsed.data.metadata ?? {},
          },
          access.userId,
        );
        if (!result.success) return writeError(result.reason);
        const reservation = await dependencies.findReservation(result.id);
        return reservation
          ? json({ reservation: itemToApi(reservation) }, 201)
          : errorResponse(
              "INTERNAL_ERROR",
              "Created reservation could not be loaded",
              500,
            );
      } catch {
        return errorResponse(
          "INTERNAL_ERROR",
          "Reservation could not be created",
          500,
        );
      }
    }
    return methodNotAllowed("GET, POST");
  }

  const match = /^reservations\/([^/]+)$/.exec(path);
  if (!match)
    return errorResponse("NOT_FOUND", "Admin API route not found", 404);
  const id = z.uuid().safeParse(match[1]);
  if (!id.success)
    return errorResponse("INVALID_REQUEST", "Invalid reservation ID", 400);
  if (request.method === "GET") {
    try {
      const reservation = await dependencies.findReservation(id.data);
      return reservation
        ? json({ reservation: itemToApi(reservation) })
        : writeError("NOT_FOUND");
    } catch {
      return errorResponse(
        "INTERNAL_ERROR",
        "Reservation could not be loaded",
        500,
      );
    }
  }
  if (request.method === "POST") {
    const forbidden = requireAdmin();
    if (forbidden) return forbidden;
    const parsed = updateBodySchema.safeParse(await bodyJson(request));
    if (!parsed.success) {
      return json(
        {
          error: "INVALID_REQUEST",
          message: "Invalid reservation request",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.updateReservation({
        id: id.data,
        ...fromApiFields(parsed.data),
      });
      if (!result.success) return writeError(result.reason);
      const reservation = await dependencies.findReservation(id.data);
      return reservation
        ? json({ reservation: itemToApi(reservation) })
        : writeError("NOT_FOUND");
    } catch {
      return errorResponse(
        "INTERNAL_ERROR",
        "Reservation could not be updated",
        500,
      );
    }
  }
  if (request.method === "DELETE") {
    const forbidden = requireAdmin();
    if (forbidden) return forbidden;
    try {
      const result = await dependencies.deleteReservation(id.data);
      if (result !== "deleted") {
        const reason = {
          "not-found": "NOT_FOUND",
          "not-manual": "NOT_MANUAL",
          "no-level": "NO_LOCATION_LEVEL",
          conflict: "CONFLICT",
        } as const;
        return writeError(reason[result]);
      }
      return json({ id: id.data, object: "reservation", deleted: true });
    } catch {
      return errorResponse(
        "INTERNAL_ERROR",
        "Reservation could not be deleted",
        500,
      );
    }
  }
  return methodNotAllowed("GET, POST, DELETE");
}
