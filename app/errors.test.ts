import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { describeError } from "./errors";

test("suite_not_passed names the release and the suite", () => {
  const e = new ConvexError({ code: "suite_not_passed", suiteVersion: "rs-1.0" });
  expect(describeError(e, { operatorVersion: "op-v1" })).toBe("Can't authorize: op-v1 hasn't passed rs-1.0.");
});

test("forbidden lists the required roles", () => {
  expect(describeError(new ConvexError({ code: "forbidden", required: ["qa"] }))).toBe("Your role can't do this. It needs: qa.");
});

test("unknown errors fall back to their message", () => {
  expect(describeError(new Error("boom"))).toBe("boom");
});
