import { ConvexError } from "convex/values";

export const CATEGORY_LABELS: Record<string, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITION_LABELS: Record<string, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Well used",
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;
export const CONDITION_KEYS = Object.keys(CONDITION_LABELS);

export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as { message?: string } | string;
    return typeof data === "string" ? data : data.message ?? "Something went wrong.";
  }
  return "Something went wrong. Try again.";
}

export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
