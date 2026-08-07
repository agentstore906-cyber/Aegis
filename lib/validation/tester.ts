import { z } from "zod";
import { AGENT_ENVIRONMENTS, AGENT_RISK_LEVELS } from "@/lib/validation/agent";
import { actionSchema } from "@/lib/validation/policy";
import { parseSafeJsonContext } from "@/lib/policies/safe-context";

export const policyTesterSchema = z.object({
  agentId: z.string().trim().min(1, "Select an agent"),
  action: actionSchema,
  resource: z.string().trim().max(80).optional().or(z.literal("")),
  environment: z.enum(AGENT_ENVIRONMENTS).optional().or(z.literal("")),
  tool: z.string().trim().max(60).optional().or(z.literal("")),
  riskLevel: z.enum(AGENT_RISK_LEVELS).optional().or(z.literal("")),
  contextJson: z
    .string()
    .max(4000)
    .optional()
    .default("")
    .transform((raw, ctx) => {
      const result = parseSafeJsonContext(raw ?? "");
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.error });
        return {};
      }
      return result.value;
    }),
});

export type PolicyTesterInput = z.infer<typeof policyTesterSchema>;
