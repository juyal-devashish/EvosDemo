import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Step 0 placeholder. The full schema (SPEC §9) lands in step 1.
export default defineSchema({
  sessions: defineTable({
    label: v.string(),
    faultInjection: v.boolean(),
  }),
});
