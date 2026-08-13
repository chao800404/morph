export const databaseErrorMessage = (error: unknown) => {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" ");
};

export const isOrderDisplayIdConflict = (error: unknown) => {
  const message = databaseErrorMessage(error);
  return (
    message.includes("orders_active_display_id_unique") ||
    message.includes("orders.display_id")
  );
};
