"use client";

import authClient from "@/auth/authClient";
import { Button } from "@/components/ui/button";
import { getDeviceIcon } from "@/lib/config/agent-map";
import { paginate } from "@/lib/config/pagination";
import { formatLastActive, simplifyUserAgent } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { sessionQueries } from "@queries/auth.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { ProfileCardComponentProps } from "../config/profile-card.types";
import { SessionDropdownMenu } from "./session-dropdown-menu";
import type { listSessions } from "@/server/auth/list-sessions.serverFn";

const ITEMS_PER_PAGE = 10;

interface ProfileSessionsCardProps extends ProfileCardComponentProps {
  sessions: Awaited<ReturnType<typeof listSessions>>["sessions"];
  currentSessionId: string | null;
  publicURL: string;
}

export const ProfileSessionsCard = ({
  slug,
  label,
  description,
  sessions,
  currentSessionId,
  publicURL,
}: ProfileSessionsCardProps) => {
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const page = Math.max(1, Number(search.page) || 1);

  const paginationData = useMemo(
    () => paginate(sessions, page, ITEMS_PER_PAGE),
    [sessions, page],
  );

  const handleRemoveOtherSessions = async () => {
    toast.promise(authClient(publicURL).revokeOtherSessions(), {
      loading: "Removing other sessions...",
      success: () => {
        queryClient.invalidateQueries(sessionQueries.list());
        return "Other sessions removed successfully!";
      },
      error: "Failed to remove other sessions. Please try again.",
    });
  };

  const columns = useMemo<DataTableColumn<(typeof sessions)[number]>[]>(
    () => [
      {
        key: "device",
        header: "Device",
        className: "w-20",
        cell: (session) => (
          <div className="flex justify-center">
            {getDeviceIcon(session.userAgent, currentSessionId === session.id)}
          </div>
        ),
      },
      {
        key: "city",
        header: "City",
        cell: (session) => session.city?.replace("City", "") || "Unknown",
      },
      {
        key: "ipAddress",
        header: "IP Address",
        className: "whitespace-nowrap",
        cell: (session) => session.ipAddress || "Unknown",
      },
      {
        key: "userAgent",
        header: "User Agent",
        className: "max-w-52 whitespace-nowrap",
        cell: (session) => {
          const value = simplifyUserAgent(session.userAgent);
          return (
            <span className="block truncate" title={value}>
              {value}
            </span>
          );
        },
      },
      {
        key: "lastActive",
        header: "Last Active",
        className: "whitespace-nowrap",
        cell: (session) => (
          <span suppressHydrationWarning>
            {formatLastActive(session.updatedAt)}
          </span>
        ),
      },
      {
        key: "created",
        header: "Created",
        className: "whitespace-nowrap",
        cell: (session) => (
          <span suppressHydrationWarning>
            {new Date(session.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [currentSessionId, sessions],
  );

  return (
    <div id={slug}>
      <DataTableCard
        label={label}
        description={description}
        headerActions={
          <Button
            variant="cardHeader"
            size="xs"
            onClick={handleRemoveOtherSessions}
          >
            Remove Other Sessions
          </Button>
        }
        columns={columns}
        rows={paginationData.paginatedItems}
        getRowId={(session) => session.id}
        emptyTitle="No active sessions"
        emptyDescription="Active dashboard sessions will appear here."
        renderRowActions={(session) => (
          <SessionDropdownMenu
            id={session.id}
            isCurrent={currentSessionId === session.id}
          />
        )}
        pagination={{
          page: paginationData.currentPage,
          limit: ITEMS_PER_PAGE,
          total: paginationData.itemsLength,
          totalPages: paginationData.totalPages,
        }}
      />
    </div>
  );
};
