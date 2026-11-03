// Shared domain types for the simulated factory (SPEC §3).
// Later steps extend this module instead of redefining these types.

/** Discrete hour offset from the start of the horizon. */
export type Hour = number;

export const HOURS_PER_SHIFT = 8;
export const HORIZON_SHIFTS = 6;
export const HORIZON_HOURS: Hour = HOURS_PER_SHIFT * HORIZON_SHIFTS;
/** Fixed setup time when consecutive jobs on a line change part family. */
export const SETUP_HOURS = 0.5;

export type ShiftLetter = "A" | "B";
export type Shift = { day: number; shift: ShiftLetter };

export type LineType = "SMT" | "THT";
export type LineId = string;
export type OrderId = string;
export type PartFamily = string;
export type PartNumber = string;

/** Half-open interval [start, end) in hours. */
export type Interval = { start: Hour; end: Hour };

export type Line = {
  lineId: LineId;
  lineType: LineType;
  /** Availability intervals; downtime is the gaps between them. */
  availability: Interval[];
};

export type BomLine = { partNumber: PartNumber; qtyPer: number };

export type Order = {
  orderId: OrderId;
  lineType: LineType;
  partFamily: PartFamily;
  qty: number;
  dueHour: Hour;
  rush: boolean;
  bom: BomLine[];
};

/** One job placed on a line: a continuous, non-preemptive run (§3). */
export type ScheduledJob = {
  orderId: OrderId;
  lineId: LineId;
  startHour: Hour;
  endHour: Hour;
};
