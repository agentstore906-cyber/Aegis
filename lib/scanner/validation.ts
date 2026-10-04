import { z } from "zod";

import {
  AGENT_TYPE_IDS,
  AUTONOMY_IDS,
  CAPABILITY_IDS,
  CONTROL_IDS,
  CONTROL_STATES,
  LIMITS,
} from "@/lib/scanner/catalog";
import { normalizeText } from "@/lib/scanner/pasted";
import type { ScanInput } from "@/lib/scanner/types";

/**
 * Server-side validation for a scan request. The wizard validates for convenience; this is the
 * boundary that counts. Every field is an allowlisted enum except two bounded strings, and unknown
 * keys are rejected (strict) rather than ignored, so a malformed or probing client gets a 422.
 */

/** A short human label for agent type "Other". Plain text only: markup, links and invisible characters are removed. */
export function sanitizeLabel(raw: string): string {
  return normalizeText(raw, 400)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[<>{}[\]\\`$|;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.maxAgentLabelChars);
}

const uniqueArray = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .transform((values) => [...new Set(values as unknown[])] as z.infer<T>[]);

export const scanRequestSchema = z.strictObject({
  agentType: z.enum(AGENT_TYPE_IDS),
  agentLabel: z.string().max(200).nullish(),
  capabilities: uniqueArray(z.enum(CAPABILITY_IDS), CAPABILITY_IDS.length),
  autonomy: uniqueArray(z.enum(AUTONOMY_IDS), AUTONOMY_IDS.length).refine((v) => v.length >= 1, "Choose what your agent can do without approval."),
  controls: z.partialRecord(z.enum(CONTROL_IDS), z.enum(CONTROL_STATES)).default({}),
  advancedText: z.string().max(LIMITS.maxAdvancedChars, `Pasted content must be ${LIMITS.maxAdvancedChars.toLocaleString("en-US")} characters or fewer.`).nullish(),
});

export type ScanFieldErrors = Record<string, string>;
export type ParsedScan = { ok: true; input: ScanInput } | { ok: false; errors: ScanFieldErrors };

export function parseScanRequest(body: unknown): ParsedScan {
  const parsed = scanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors: ScanFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "request");
      errors[key] ??= safeIssueMessage(key, issue.message);
    }
    return { ok: false, errors };
  }
  const value = parsed.data;

  // "Read only" describes the whole agent; combining it with a higher level is a contradiction.
  if (value.autonomy.includes("read_only") && value.autonomy.length > 1) {
    return { ok: false, errors: { autonomy: "“Read only” can’t be combined with other levels." } };
  }

  const label = value.agentType === "other" && value.agentLabel ? sanitizeLabel(value.agentLabel) : "";
  const text = value.advancedText ? normalizeText(value.advancedText, LIMITS.maxAdvancedChars).trim() : "";

  return {
    ok: true,
    input: {
      agentType: value.agentType,
      agentLabel: label.length > 0 ? label : null,
      capabilities: value.capabilities,
      autonomy: value.autonomy,
      controls: value.controls,
      advancedText: text.length > 0 ? text : null,
    },
  };
}

/** Zod messages for enum mismatches echo the submitted value; never reflect user input back in an error. */
function safeIssueMessage(field: string, message: string): string {
  if (field === "advancedText" && message.startsWith("Pasted content")) return message;
  if (field === "autonomy" && message.startsWith("Choose")) return message;
  return `Invalid value for ${field}.`;
}
