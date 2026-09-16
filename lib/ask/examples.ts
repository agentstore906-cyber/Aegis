/**
 * Client-safe (no "server-only", no server-side imports) — split out from
 * lib/ask/answer.ts so the Ask Aegis form (a Client Component) never pulls
 * the query layer / Prisma into the browser bundle just to show example
 * questions.
 */
export const ASK_AEGIS_EXAMPLE_QUESTIONS = [
  "What did my agents do today?",
  "Which agent accessed customer data?",
  "Why did AI costs increase this week?",
  "Which agent is behaving abnormally?",
  "Show me the highest-risk agent.",
  "Which actions were blocked?",
  "Which actions required approval?",
  "Which agents sent external requests?",
];
