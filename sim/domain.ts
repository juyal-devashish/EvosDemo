// Shared domain types for the simulated factory (SPEC §3).
// Later steps extend this module instead of redefining these types.
// Convex validators in convex/lib/validators.ts mirror these shapes.

/** Discrete hour offset from the start of the horizon (hour 0 = now). */
export type Hour = number;

export const HOURS_PER_SHIFT = 8;
export const HORIZON_SHIFTS = 6;
export const HORIZON_HOURS: Hour = HOURS_PER_SHIFT * HORIZON_SHIFTS;
/** Fixed setup time when consecutive jobs on a line change part family. */
export const SETUP_HOURS = 0.5;
/** Tolerance for comparing computed hour values (products of floats). */
export const EPS = 1e-6;

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
  /**
   * Tie-breaker in the documented priority rule (lower = higher priority).
   * See `comparePriority` in sim/model.ts.
   */
  priorityRank: number;
  bom: BomLine[];
};

/** Hours per unit for a (line, part family). */
export type CycleTime = { lineId: LineId; partFamily: PartFamily; hoursPerUnit: number };

/** MES observation; carries part family and shift so a slow mix isn't read as a slow machine. */
export type CycleTimeObservation = CycleTime & { day: number; shift: ShiftLetter };

export type StockRecord = { partNumber: PartNumber; onHand: number };
export type Arrival = { partNumber: PartNumber; qty: number; arrivalHour: Hour; confirmed: boolean };
/** Units held for work outside the movable set; two jobs can't consume the same units. */
export type Reservation = { reservationId: string; holder: string; partNumber: PartNumber; qty: number };

/** One job placed on a line: a continuous, non-preemptive run (§3). */
export type ScheduledJob = {
  orderId: OrderId;
  lineId: LineId;
  startHour: Hour;
  endHour: Hour;
};

export type FrozenJob = ScheduledJob & { partFamily: PartFamily };

export type DataSource = "erp_routing" | "erp_stock" | "mes_cycle_times";

/**
 * Everything the backend knows about the factory at one moment. Ages are
 * computed server-side from `asOfShift`; the model's claims are not trusted.
 */
export type FactorySnapshot = {
  nowShift: number;
  horizonHours: Hour;
  lines: Line[];
  /** Open, movable orders. */
  orders: Order[];
  /** Started work; occupies its line until its end. */
  frozenJobs: FrozenJob[];
  /** ERP routing standard: the source of record for durations (G7). */
  standardCycleTimes: CycleTime[];
  mesObservations: CycleTimeObservation[];
  stock: StockRecord[];
  arrivals: Arrival[];
  reservations: Reservation[];
  /** Shift index each source was last refreshed. */
  dataAsOfShift: Record<DataSource, number>;
};

// Plan body (SPEC §6). Zod schema for model output arrives in step 3.

export type DispositionStatus = "scheduled" | "held" | "escalated";
export type Commitment = "on_time" | "late" | "none";

export type Disposition = {
  orderId: OrderId;
  status: DispositionStatus;
  commitment: Commitment;
  cannotFinishBefore?: Hour;
};

export type Escalation = { orderId?: OrderId; reason: string };

export type Plan = {
  schedule: ScheduledJob[];
  dispositions: Disposition[];
  escalations: Escalation[];
  summary: string;
};
