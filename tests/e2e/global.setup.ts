import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { loadEnvLocal } from "./env";

// Clerk testing token, so signed-in tests bypass bot protection.
setup.describe.configure({ mode: "serial" });
setup("clerk setup", async () => {
  loadEnvLocal();
  await clerkSetup();
});
