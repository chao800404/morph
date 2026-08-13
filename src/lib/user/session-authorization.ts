export const canRevokeSession = (
  sessionOwnerId: string,
  currentUserId: string,
): boolean => sessionOwnerId === currentUserId;
