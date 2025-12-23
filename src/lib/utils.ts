import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatLastActive = (date: Date | string): string => {
  const now = new Date();
  const targetDate = typeof date === "string" ? new Date(date) : date;
  const diffInMinutes = Math.floor(
    (now.getTime() - targetDate.getTime()) / (1000 * 60),
  );

  if (diffInMinutes < 1) return "Active now";
  if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hours ago`;

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} days ago`;
};

export function simplifyUserAgent(ua?: string | null) {
  if (!ua) return "Unknown";
  let device = "";
  let os = "";
  let osVersion = "";
  let deviceType = "";
  let browser = "";

  if (/iPhone/.test(ua)) {
    device = "iPhone";
    os = "iOS";
  } else if (/iPad/.test(ua)) {
    device = "iPad";
    os = "iOS";
  } else if (/Android/.test(ua)) {
    device = "Android";
    os = "Android";
  } else if (/Windows/.test(ua)) {
    device = "Windows";
    os = "Windows";
  } else if (/Mac OS X/.test(ua)) {
    device = "Mac";
    os = "macOS";
  }

  const iOSMatch = ua.match(/OS (\d+_\d+_?\d*)/);
  if (iOSMatch) {
    osVersion = iOSMatch[1].replace(/_/g, ".");
  }

  const androidMatch = ua.match(/Android (\d+\.?\d*\.?\d*)/);
  if (androidMatch) {
    osVersion = androidMatch[1];
  }

  if (/Mobile/.test(ua)) {
    deviceType = "Mobile";
  } else if (/Tablet|iPad/.test(ua)) {
    deviceType = "Tablet";
  }

  if (/Chrome/.test(ua) && !/Edg/.test(ua)) {
    browser = "Chrome";
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    browser = "Safari";
  } else if (/Firefox/.test(ua)) {
    browser = "Firefox";
  } else if (/Edg/.test(ua)) {
    browser = "Edge";
  }

  const parts = [device];
  if (osVersion) {
    parts.push(`${os} ${osVersion}`);
  } else if (os && os !== device) {
    parts.push(os);
  }
  if (deviceType) {
    parts.push(deviceType);
  }
  if (browser) {
    parts.push(browser);
  }

  return parts.join(", ");
}

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

export const formatDate = (date: Date | string | number): string => {
  if (!date) return "";
  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(targetDate);
};

/**
 * Format duration in seconds to HH:MM:SS format
 * @param seconds - Duration in seconds
 * @returns Formatted duration string (e.g., "1:23:45" or "2:30")
 */
export const formatDuration = (seconds: number): string => {
  if (!seconds || seconds < 0) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
};

/**
 * Determine file type from MIME type string
 * @param mimeType - MIME type string (e.g., "image/jpeg", "video/mp4")
 * @returns Simple file type string ("image", "video", "audio", "file", or "unknown")
 */
export const getFileType = (
  mimeType?: string | null,
): "image" | "video" | "audio" | "file" | "unknown" => {
  if (!mimeType) return "unknown";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
};

/**
 * Extract file extension from filename (without the dot)
 * @param filename - Filename with extension (e.g., "image.jpg", "video.mp4")
 * @returns File extension in lowercase without dot (e.g., "jpg", "mp4"), or empty string if no extension found
 */
export const getFileExtension = (filename: string): string => {
  if (!filename) return "";
  // Remove query parameters if present
  const cleanFilename = filename.split("?")[0];
  if (!cleanFilename.includes(".")) return "";
  const extension = cleanFilename.split(".").pop()?.toLowerCase();
  return extension || "";
};
