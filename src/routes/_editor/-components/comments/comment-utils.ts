import { Monitor, Smartphone, Tablet } from "lucide-react";

export const AUTHOR_PALETTES = [
  { bg: "bg-blue-600", text: "text-white" },
  { bg: "bg-violet-600", text: "text-white" },
  { bg: "bg-emerald-600", text: "text-white" },
  { bg: "bg-amber-600", text: "text-white" },
  { bg: "bg-rose-600", text: "text-white" },
  { bg: "bg-indigo-600", text: "text-white" },
  { bg: "bg-teal-600", text: "text-white" },
  { bg: "bg-cyan-600", text: "text-white" },
];

export function getAuthorPalette(idOrName?: string | null) {
  if (!idOrName) return AUTHOR_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < idOrName.length; i++) {
    hash = (hash << 5) - hash + idOrName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AUTHOR_PALETTES.length;
  return AUTHOR_PALETTES[index];
}

export function getInitials(name?: string | null): string {
  if (!name) return "U";
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function getInitialLetter(name?: string | null): string {
  if (!name) return "U";
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "U";
}

export function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

export function getViewportIcon(width: number) {
  if (width >= 1024) return Monitor;
  if (width >= 640) return Tablet;
  return Smartphone;
}
