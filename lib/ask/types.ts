export type EvidenceItem = {
  type: "agent" | "activity_event" | "policy_evaluation" | "approval" | "security_alert";
  label: string;
  detail?: string;
  href: string;
  timestamp?: Date;
};

export type AskAnswer = {
  /** Which built-in intent answered this — "none" when nothing matched (see the fallback in lib/ask/answer.ts). */
  intent: string;
  summary: string;
  evidence: EvidenceItem[];
};
