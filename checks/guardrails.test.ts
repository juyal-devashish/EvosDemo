import { describe, expect, test } from "vitest";
import type { ScheduledJob } from "../sim/domain";
import { g1NoOverlap, g4InsideHorizon, g5SchemaValid, g6InScope, runGuardrails } from "./guardrails";

const job = (orderId: string, lineId: string, startHour: number, endHour: number): ScheduledJob => ({
  orderId,
  lineId,
  startHour,
  endHour,
});

describe("G1 no overlap", () => {
  test("passes: back-to-back jobs and frozen work on the same line", () => {
    expect(g1NoOverlap([job("o1", "SMT-1", 4, 8), job("o2", "SMT-1", 8, 10)], [job("f1", "SMT-1", 0, 4)])).toEqual([]);
  });
  test("fails: overlap with another movable job", () => {
    const f = g1NoOverlap([job("o1", "SMT-1", 0, 5), job("o2", "SMT-1", 4, 8)], []);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "G1", orderId: "o1" });
  });
  test("fails: overlap with frozen work", () => {
    expect(g1NoOverlap([job("o1", "SMT-1", 3, 6)], [job("f1", "SMT-1", 0, 4)])).toMatchObject([
      { id: "G1", orderId: "o1" },
    ]);
  });
  test("fails: rescheduling a frozen job", () => {
    expect(g1NoOverlap([job("f1", "SMT-2", 10, 14)], [job("f1", "SMT-1", 0, 4)])).toMatchObject([
      { id: "G1", orderId: "f1" },
    ]);
  });
});

describe("G4 inside horizon", () => {
  test("passes inside", () => expect(g4InsideHorizon([job("o1", "L", 0, 48)], 48)).toEqual([]));
  test("fails past the end", () =>
    expect(g4InsideHorizon([job("o1", "L", 40, 49)], 48)).toMatchObject([{ id: "G4" }]));
});

describe("G5 schema-valid", () => {
  test("passes a well-formed schedule", () => expect(g5SchemaValid([job("o1", "L", 0, 2)])).toEqual([]));
  test("fails zero length and duplicate orders", () => {
    const f = g5SchemaValid([job("o1", "L", 2, 2), job("o1", "L", 3, 4)]);
    expect(f.map((x) => x.message)).toEqual(["job must end after it starts", "order scheduled more than once"]);
  });
});

describe("G6 in scope", () => {
  test("passes the granted scope", () => expect(g6InScope("scheduling", "scheduling")).toEqual([]));
  test("fails another scope", () => expect(g6InScope("scheduling", "purchasing")).toMatchObject([{ id: "G6" }]));
});

test("runGuardrails reports what it can't check yet", () => {
  const r = runGuardrails({
    grantedScope: "scheduling",
    proposalScope: "scheduling",
    horizonHours: 48,
    frozenJobs: [],
    schedule: [job("o1", "SMT-1", 0, 4)],
  });
  expect(r).toEqual({ ok: true, failures: [], notYetImplemented: ["G2", "G3", "G7", "G8"] });
});
