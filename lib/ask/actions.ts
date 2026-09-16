"use server";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { answerQuestion } from "@/lib/ask/answer";
import type { AskAnswer } from "@/lib/ask/types";

const MAX_QUESTION_LENGTH = 300;

export type AskAegisState = {
  error?: string;
  question?: string;
  answer?: AskAnswer;
};

/**
 * Ask Aegis is read-only investigation, not a mutation — every organization
 * member (including VIEWER) can use it, same as Policy Evaluations/Approval
 * history. `organizationId` always comes from the authenticated session,
 * never from client input — see lib/ask/answer.ts's docstring for the rest
 * of the security model (no LLM, so no prompt-injection surface).
 */
export async function askAegisAction(_prevState: AskAegisState, formData: FormData): Promise<AskAegisState> {
  const { organization } = await requireActiveOrganization();

  const question = String(formData.get("question") ?? "").trim();
  if (question.length === 0) {
    return { error: "Ask a question first." };
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return { error: `Keep it under ${MAX_QUESTION_LENGTH} characters.` };
  }

  const answer = await answerQuestion(organization.id, question);
  return { question, answer };
}
