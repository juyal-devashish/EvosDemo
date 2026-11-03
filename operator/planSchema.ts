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

export const PlanSchema = z.object({
  schedule: z.array(ScheduleEntrySchema),
  dispositions: z.array(DispositionSchema),
  escalations: z.array(EscalationSchema),
  summary: z.string(),
});

export type PlanFromModel = z.infer<typeof PlanSchema>;
