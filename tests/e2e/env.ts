import { existsSync, readFileSync } from "node:fs";

/** Load .env.local into process.env (Playwright doesn't). Existing env vars win. */
export function loadEnvLocal(): void {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

/** NEXT_PUBLIC_CONVEX_URL from the environment or .env.local. */
export function convexUrl(): string {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not found");
  return url;
}

export function e2eUser(role: "qa" | "planner") {
  loadEnvLocal();
  const prefix = role === "qa" ? "E2E_QA" : "E2E_PLANNER";
  const identifier = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  return identifier && password ? { identifier, password } : null;
}
