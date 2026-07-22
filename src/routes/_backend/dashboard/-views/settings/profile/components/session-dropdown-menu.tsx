"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sessionQueries } from "@/routes/_backend/dashboard/-queries/auth.queries";
import { revokeSession } from "@/server/auth/revoke-session.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface SessionDropdownMenuProps {
  id: string;
  token?: string;
  isCurrent?: boolean;
}

export const SessionDropdownMenu = ({
  id,
  isCurrent,
}: SessionDropdownMenuProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const handleRevoke = async () => {
    if (isCurrent) {
      toast.error(
        "You cannot revoke your current session here. Please use sign out instead.",
      );
      return;
    }

    setPending(true);
    try {
      // Pass the session ID to the server function
      const result = await revokeSession({ data: { id } });

      if (result.success === false) {
        toast.error(result.message || "Failed to revoke session");
        return;
      }

      toast.success("Session revoked");

      // Invalidate the sessions list query
      queryClient.invalidateQueries(sessionQueries.list());

      // Also invalidate the router just in case
      router.invalidate();
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive cursor-pointer"
          onClick={handleRevoke}
          disabled={isCurrent}
        >
          <Trash2 className="mr-2 size-4" />
          <span>Revoke Session</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
