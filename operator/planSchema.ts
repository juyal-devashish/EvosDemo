import { z } from "zod";

// Zod schema for the operator's structured output (SPEC §6). It mirrors
// sim/domain.ts#Plan; `PlanFromModel` must stay assignable to `Plan`.
// Every number shown on screen comes from these fields; `summary` is
// narrative only.

export const ScheduleEntrySchema = z.object({
  orderId: z.string(),
  lineId: z.string(),
  startHour: z.number(),
  endHour: z.number(),
});

export const DispositionSchema = z.object({
  orderId: z.string(),
  status: z.enum(["scheduled", "held", "escalated"]),
  commitment: z.enum(["on_time", "late", "none"]),
  cannotFinishBefore: z.number().optional(),
});

export const EscalationSchema = z.object({
  orderId: z.string().optional(),
  reason: z.string(),
});

// Field order matters: structured output is generated in schema order.
// Dispositions and escalations come first, so the model decides each
// order's status before writing the schedule that gets executed. With
// schedule first, the pilot saw a slot written for an order the model
// then escalated ("the schedule entry ... was a mistake").
export const PlanSchema = z.object({
  dispositions: z.array(DispositionSchema),
  escalations: z.array(EscalationSchema),
  schedule: z.array(ScheduleEntrySchema),
  summary: z.string(),
});

export type PlanFromModel = z.infer<typeof PlanSchema>;
