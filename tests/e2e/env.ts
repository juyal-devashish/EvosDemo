import { readFileSync } from "node:fs";

/** NEXT_PUBLIC_CONVEX_URL from the environment or .env.local (Playwright doesn't load it). */
export function convexUrl(): string {
  if (process.env.NEXT_PUBLIC_CONVEX_URL) return process.env.NEXT_PUBLIC_CONVEX_URL;
  const line = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEXT_PUBLIC_CONVEX_URL="));
  if (!line) throw new Error("NEXT_PUBLIC_CONVEX_URL not found");
  return line.slice("NEXT_PUBLIC_CONVEX_URL=".length).trim();
}
