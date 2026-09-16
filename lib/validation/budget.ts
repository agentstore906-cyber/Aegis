import { z } from "zod";

export const BUDGET_PERIODS = ["DAILY", "MONTHLY"] as const;

export const budgetSchema = z.object({
  agentId: z.string().trim().max(60).optional().or(z.literal("")),
  period: z.enum(BUDGET_PERIODS),
  // Dollars in the form, cents in storage — same pattern as lib/costs elsewhere.
  limitDollars: z.coerce.number().positive("Budget must be greater than $0").max(1_000_000),
  warningThresholdPercent: z.coerce.number().int().min(1).max(100),
});

export type BudgetFormInput = z.infer<typeof budgetSchema>;
