import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "./modules";

describe("convex-test harness", () => {
  test("a mutation's write is visible to a query", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await t.mutation(api.sessions.create, {
      label: "smoke",
      faultInjection: false,
    });
    const session = await t.query(api.sessions.get, { sessionId });
    expect(session).toMatchObject({ label: "smoke", faultInjection: false });
  });
});
