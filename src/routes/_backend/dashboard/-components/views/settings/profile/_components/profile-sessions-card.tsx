"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDeviceIcon } from "@/lib/config/agent-map";
import { paginate } from "@/lib/config/pagination";
import { cn, formatLastActive, simplifyUserAgent } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { CardPagination } from "../../../../card-pagination/card-pagination";
import { CardWrapper } from "../../../../card-wrapper";
import { ProfileCardComponentProps } from "../_config/profile-card.types";
import { SessionDropdownMenu } from "./session-dropdown-menu";

const ITEMS_PER_PAGE = 10;

interface ProfileSessionsCardProps extends ProfileCardComponentProps {
  sessions: any[];
  currentSessionId: string | null;
}

export const ProfileSessionsCard = ({
  slug,
  label,
  description,
  sessions,
  currentSessionId,
}: ProfileSessionsCardProps) => {
  const [page, setPage] = useState(1);

  const paginationData = useMemo(
    () => paginate(sessions, page, ITEMS_PER_PAGE),
    [sessions, page],
  );

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(sessions.length / ITEMS_PER_PAGE));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [sessions.length, page]);

  const handlePageChange = (action: "first" | "prev" | "next" | "last") => {
    setPage((prev) => {
      const totalPages = Math.max(
        1,
        Math.ceil(sessions.length / ITEMS_PER_PAGE),
      );
      switch (action) {
        case "first":
          return 1;
        case "prev":
          return prev > 1 ? prev - 1 : 1;
        case "next":
          return prev < totalPages ? prev + 1 : totalPages;
        case "last":
          return totalPages;
        default:
          return prev;
      }
    });
  };

  return (
    <div id={slug}>
      <CardWrapper
        label={label}
        description={description}
        classNames={{
          contentWrapper: "px-0 overflow-x-auto",
          headerWrapper: "max-sm:flex-col max-sm:gap-4",
        }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className={cn(
                  "pl-6 w-14 whitespace-nowrap sticky left-0 z-20 bg-accent",
                )}
              >
                Device
              </TableHead>
              <TableHead className="whitespace-nowrap">City</TableHead>
              <TableHead className="whitespace-nowrap">IP Address</TableHead>
              <TableHead className="whitespace-nowrap">User Agent</TableHead>
              <TableHead className="whitespace-nowrap">Last Active</TableHead>
              <TableHead className="whitespace-nowrap">Created</TableHead>
              <TableHead className="pr-6 w-14 whitespace-nowrap"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  No active sessions found.
                </TableCell>
              </TableRow>
            ) : (
              paginationData.paginatedItems.map((session) => {
                const userAgentDisplay = simplifyUserAgent(session.userAgent);
                const isCurrent = currentSessionId === session.id;
                const Device = getDeviceIcon(session.userAgent, isCurrent);

                return (
                  <TableRow
                    data-active={isCurrent}
                    className={cn("data-[active=true]:bg-muted group")}
                    key={session.id}
                  >
                    <TableCell
                      className={cn(
                        "text-start pl-6 sticky left-0 z-20 group-data-[active=true]:bg-muted",
                      )}
                    >
                      <div className="flex justify-center text-center gap-0.5">
                        {Device}
                      </div>
                    </TableCell>
                    <TableCell>
                      {session.city?.replace("City", "") || "Unknown"}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      {session.ipAddress || "Unknown"}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap max-w-[200px] truncate"
                      title={userAgentDisplay}
                    >
                      {userAgentDisplay}
                    </TableCell>
                    <TableCell
                      suppressHydrationWarning
                      className="whitespace-nowrap"
                    >
                      {formatLastActive(session.updatedAt)}
                    </TableCell>
                    <TableCell
                      suppressHydrationWarning
                      className="whitespace-nowrap"
                    >
                      {new Date(session.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-center pr-6 sticky right-0 z-20 group-data-[active=true]:bg-muted",
                      )}
                    >
                      <SessionDropdownMenu
                        id={session.id}
                        isCurrent={isCurrent}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <div className="px-6 py-4 text-sm border-t">
          <CardPagination
            page={page}
            totalPages={paginationData.totalPages}
            itemsLength={paginationData.itemsLength}
            startItem={paginationData.startItem}
            endItem={paginationData.endItem}
            onPageChange={handlePageChange}
          />
        </div>
      </CardWrapper>
    </div>
  );
};
