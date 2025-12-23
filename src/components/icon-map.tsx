import * as LucideIcons from "lucide-react";
import { LucideIcon } from "lucide-react";

/**
 * Get Lucide icon component by name
 */
export function getIconByName(iconName: string): LucideIcon {
  const Icon = (LucideIcons as any)[iconName];
  return Icon || LucideIcons.HelpCircle; // Fallback icon
}
