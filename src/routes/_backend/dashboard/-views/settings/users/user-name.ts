/** Better Auth stores one name; this is the Medusa-compatible view adapter. */
export const splitUserName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "",
  };
};
