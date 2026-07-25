import * as LucideIcons from "lucide-react";
import { LucideIcon } from "lucide-react";

// The namespace export mixes components with helpers, so it is narrowed once
// here rather than at every lookup.
const iconRegistry = LucideIcons as unknown as Record<
  string,
  LucideIcon | undefined
>;

/**
 * Get Lucide icon component by name
 */
export function getIconByName(iconName: string): LucideIcon {
  return iconRegistry[iconName] ?? LucideIcons.HelpCircle; // Fallback icon
}
