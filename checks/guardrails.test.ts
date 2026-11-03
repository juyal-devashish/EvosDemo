import { describe, expect, test } from "vitest";
import type { FactorySnapshot, Plan } from "../sim/domain";
import { runGuardrails, type GuardrailId } from "./guardrails";
import { job, order, planOf, snapshot } from "./testkit";

// Each guardrail has a passing and a failing fixture (AGENTS.md).

const ids = (s: FactorySnapshot, plan: Plan, dataView = { includeMesCycleTimes: false }, proposalScope = "scheduling") =>
  runGuardrails({ grantedScope: "scheduling", proposalScope, snapshot: s, plan, dataView }).failures.map(
    (f) => `${f.id}:${f.orderId ?? ""}`,
  );

const GOOD = planOf([job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 0, 4), job("o3", "THT-1", 0, 4)]);

test("a valid plan passes all of G1–G8", () => {
  expect(ids(snapshot(), GOOD)).toEqual([]);
});

const cases: { id: GuardrailId; name: string; s?: FactorySnapshot; plan: Plan; dataView?: { includeMesCycleTimes: boolean; maxDataAgeShifts?: number }; scope?: string; expected: string[] }[] = [
  { id: "G1", name: "overlap with frozen work", plan: planOf([job("o1", "SMT-1", 3, 7)]), expected: ["G1:o1"] },
  { id: "G1", name: "overlap between movable jobs", plan: planOf([job("o1", "SMT-2", 0, 4), job("o2", "SMT-2", 3.5, 8)]), expected: ["G1:o1"] },
  { id: "G1", name: "moving frozen work", plan: planOf([job("f1", "SMT-2", 10, 14)]), expected: ["G1:f1"] },
  {
    id: "G2",
    name: "consuming reserved stock",
    s: snapshot({
      orders: [order({ orderId: "o1", bom: [{ partNumber: "CONN", qtyPer: 1 }] })],
      stock: [{ partNumber: "CONN", onHand: 50 }],
      reservations: [{ reservationId: "r", holder: "x", partNumber: "CONN", qty: 20 }],
    }),
    plan: planOf([job("o1", "SMT-1", 4, 8)]),
    expected: ["G2:o1"],
  },
  {
    id: "G2",
    name: "starting before a confirmed arrival",
    s: snapshot({
      orders: [order({ orderId: "o1", bom: [{ partNumber: "IC", qtyPer: 1 }] })],
      arrivals: [{ partNumber: "IC", qty: 40, arrivalHour: 16, confirmed: true }],
    }),
    plan: planOf([job("o1", "SMT-1", 8, 12)]),
    expected: ["G2:o1"],
  },
  { id: "G3", name: "SMT order on a THT line", plan: planOf([job("o1", "THT-1", 0, 4)]), expected: ["G3:o1"] },
  {
    id: "G4",
    name: "job inside line downtime",
    s: snapshot({
      lines: [
        { lineId: "SMT-1", lineType: "SMT", availability: [{ start: 0, end: 48 }] },
        { lineId: "SMT-2", lineType: "SMT", availability: [{ start: 0, end: 2 }, { start: 16, end: 48 }] },
        { lineId: "THT-1", lineType: "THT", availability: [{ start: 0, end: 48 }] },
      ],
    }),
    plan: planOf([job("o2", "SMT-2", 0, 4)]),
    expected: ["G4:o2"],
  },
  { id: "G4", name: "past the horizon", plan: planOf([job("o2", "SMT-2", 46, 50)]), expected: ["G4:o2"] },
  { id: "G5", name: "zero-length job", plan: planOf([job("o2", "SMT-2", 4, 4)]), expected: ["G5:o2", "G7:o2"] },
  {
    id: "G5",
    name: "`scheduled` disposition without a job",
    plan: { ...planOf([]), dispositions: [{ orderId: "o1", status: "scheduled", commitment: "on_time" }] },
    expected: ["G5:o1"],
  },
  { id: "G6", name: "another scope", plan: planOf([job("o2", "SMT-2", 0, 4)]), scope: "purchasing", expected: ["G6:"] },
  { id: "G6", name: "an order that isn't open", plan: planOf([job("zz", "SMT-2", 0, 4)]), expected: ["G6:zz"] },
  { id: "G7", name: "shrunk job", plan: planOf([job("o2", "SMT-2", 0, 3.5)]), expected: ["G7:o2"] },
  {
    id: "G7",
    name: "missing setup after a family change",
    plan: planOf([job("o2", "SMT-1", 4, 8)]), // f1 is family A, o2 is B: needs 4.5 h
    expected: ["G7:o2"],
  },
  {
    id: "G8",
    name: "commitment on a stale stock snapshot",
    s: snapshot({
      nowShift: 5,
      orders: [order({ orderId: "o1", bom: [{ partNumber: "CAP", qtyPer: 1 }] })],
      stock: [{ partNumber: "CAP", onHand: 1000 }],
      dataAsOfShift: { erp_routing: 5, erp_stock: 1, mes_cycle_times: 5 },
    }),
    plan: planOf([job("o1", "SMT-1", 4, 8)]),
    expected: ["G8:o1"],
  },
  {
    id: "G8",
    name: "commitment on stale MES data when the data view includes it",
    s: snapshot({ nowShift: 5, dataAsOfShift: { erp_routing: 5, erp_stock: 5, mes_cycle_times: 1 } }),
    plan: planOf([job("o2", "SMT-2", 0, 4)]),
    dataView: { includeMesCycleTimes: true, maxDataAgeShifts: 2 },
    expected: ["G8:o2"],
  },
];

describe.each(cases)("$id fails: $name", ({ s, plan, dataView, scope, expected }) => {
  test("reports exactly the expected failures", () => {
    expect(ids(s ?? snapshot(), plan, dataView, scope)).toEqual(expected);
  });
});

describe("passing counterparts", () => {
  test("G2: waits for the arrival", () => {
    const s = snapshot({
      orders: [order({ orderId: "o1", bom: [{ partNumber: "IC", qtyPer: 1 }] })],
      arrivals: [{ partNumber: "IC", qty: 40, arrivalHour: 16, confirmed: true }],
    });
    expect(ids(s, planOf([job("o1", "SMT-1", 16, 20)]))).toEqual([]);
  });
  test("G2: an unconfirmed arrival doesn't count", () => {
    const s = snapshot({
      orders: [order({ orderId: "o1", bom: [{ partNumber: "IC", qtyPer: 1 }] })],
      arrivals: [{ partNumber: "IC", qty: 40, arrivalHour: 16, confirmed: false }],
    });
    expect(ids(s, planOf([job("o1", "SMT-1", 16, 20)]))).toEqual(["G2:o1"]);
  });
  test("G7: setup included after a family change", () => {
    expect(ids(snapshot(), planOf([job("o2", "SMT-1", 4, 8.5)]))).toEqual([]);
  });
  test("G8: stale data is fine with no commitment", () => {
    const s = snapshot({
      nowShift: 5,
      orders: [order({ orderId: "o1", bom: [{ partNumber: "CAP", qtyPer: 1 }] })],
      stock: [{ partNumber: "CAP", onHand: 1000 }],
      dataAsOfShift: { erp_routing: 5, erp_stock: 1, mes_cycle_times: 5 },
    });
    const plan: Plan = {
      ...planOf([]),
      dispositions: [{ orderId: "o1", status: "escalated", commitment: "none" }],
      escalations: [{ orderId: "o1", reason: "stock snapshot stale" }],
    };
    expect(ids(s, plan)).toEqual([]);
  });
});
