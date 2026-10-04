import type { CapabilityId } from "@/lib/scanner/catalog";
import type { PastedSignalSummary } from "@/lib/scanner/types";

/**
 * Analysis of optional pasted text (configuration, prompt, tool definitions, logs).
 *
 * Security model — pasted text is DATA, never instructions:
 *   - It is never executed, evaluated, fetched, rendered or sent to a model.
 *   - It is normalised (control / zero-width / bidi characters removed), then scanned with a fixed
 *     list of bounded, linear-time regular expressions.
 *   - The only things that leave this module are allowlisted signal ids, capped counts and inferred
 *     capability ids. Nothing the user typed is copied into the result, so neither a secret nor an
 *     injected instruction can reach the report, the database, a log line or a share page.
 *   - Pasted text can only ADD evidence of risk. Claims like "requires approval" in the text are never
 *     credited as a control (anyone can write that sentence), and instruction-like text has no effect
 *     on the score — it cannot be used to talk the scanner into a better result.
 */

const INVISIBLE = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]", "g");

/** Strips characters that hide or reorder text, NFKC-normalises, and bounds length. */
export function normalizeText(text: string, maxChars: number): string {
  return text.normalize("NFKC").replace(INVISIBLE, "").slice(0, maxChars);
}

type Rule = { id: string; label: string; pattern: RegExp; infers?: CapabilityId };

const COUNT_CAP = 99;

// Secret-LIKE shapes. Only their existence and count are reported — the matched text is dropped.
const SECRET_RULES: Rule[] = [
  { id: "secret_openai_style_key", label: "API-key-like string", pattern: /\bsk-[a-z0-9_-]{16,}/gi },
  { id: "secret_aws_access_key", label: "Cloud access-key-like string", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "secret_github_token", label: "Source-control token-like string", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { id: "secret_chat_token", label: "Chat-platform token-like string", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: "secret_private_key_block", label: "Private-key block", pattern: /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----/g },
  { id: "secret_jwt", label: "JSON-web-token-like string", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g },
  { id: "secret_url_credentials", label: "Credentials embedded in a URL", pattern: /\b[a-z][a-z0-9+.-]{2,10}:\/\/[^\s:@/]{1,40}:[^\s@/]{1,60}@/gi },
  {
    id: "secret_assignment",
    label: "Hard-coded secret assignment",
    pattern: /\b(?:api[_-]?key|secret|token|passwd|password)\b\s{0,3}["']?\s{0,3}[:=]\s{0,3}["']?[A-Za-z0-9_\-./+=]{8,}/gi,
  },
];

const CAPABILITY_RULES: Rule[] = [
  { id: "mentions_shell", label: "Shell / terminal access", infers: "shell", pattern: /\b(?:bash|powershell|zsh|\/bin\/sh|subprocess|child_process|os\.system|terminal)\b/gi },
  { id: "mentions_code_exec", label: "Code execution", infers: "code_execution", pattern: /\b(?:eval\(|exec\(|code[_ -]?interpreter|run[_ -]?code|python[_ -]?repl|execute[_ -]?code)/gi },
  { id: "mentions_web", label: "Web access", infers: "web_browsing", pattern: /\b(?:browse|web[_ -]?search|fetch[_ -]?url|http[_ -]?get|scrape|playwright|puppeteer|selenium)\b/gi },
  { id: "mentions_email_send", label: "Outbound email", infers: "send_emails", pattern: /\b(?:send[_ -]?email|smtp|sendgrid|mailgun|gmail\.send)\b/gi },
  { id: "mentions_delete", label: "Destructive operations", infers: "delete_data", pattern: /\b(?:rm -rf|delete[_ -]?(?:file|record|row|user|data)|drop table|truncate table)\b/gi },
  { id: "mentions_payments", label: "Payments", infers: "execute_transactions", pattern: /\b(?:stripe|paypal|transfer[_ -]?funds|wire[_ -]?transfer|payment)\b/gi },
  { id: "mentions_purchases", label: "Purchasing", infers: "make_purchases", pattern: /\b(?:purchase|checkout|place[_ -]?order)\b/gi },
  { id: "mentions_cloud", label: "Cloud / infrastructure tooling", infers: "cloud_services", pattern: /\b(?:aws|boto3|gcloud|azure|kubectl|terraform)\b/gi },
  { id: "mentions_database", label: "Database access", infers: "databases", pattern: /\b(?:postgres|mysql|mongodb|sql[_ -]?query|select\s{1,5}[\w*,\s]{1,80}\sfrom)\b/gi },
  { id: "mentions_filesystem", label: "File access", infers: "file_system", pattern: /\b(?:read[_ -]?file|write[_ -]?file|filesystem|fs\.(?:read|write))/gi },
  { id: "mentions_api", label: "API / webhook calls", infers: "apis", pattern: /\b(?:openapi|swagger|http[_ -]?request|api[_ -]?call|webhook)\b/gi },
  { id: "mentions_mcp", label: "MCP server configuration", infers: "apis", pattern: /\bmcp[_ -]?servers?\b/gi },
];

// Reported for transparency only — never credited and never penalised.
const NEUTRAL_RULES: Rule[] = [
  { id: "approval_language", label: "Approval language (not credited as a control)", pattern: /\b(?:require[_ -]?approval|human[_ -]?approval|ask the user before|confirm before)\b/gi },
  {
    id: "instruction_like_text",
    label: "Instruction-like text (treated as data and ignored)",
    pattern: /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier)\b[^.\n]{0,20}\binstructions?\b|\byou are now\b|\bsystem override\b/gi,
  },
];

function countMatches(pattern: RegExp, text: string): number {
  let n = 0;
  // matchAll clones the regex, so the shared global patterns never leak lastIndex state between calls.
  const matches = text.matchAll(pattern);
  while (n < COUNT_CAP && !matches.next().done) n += 1;
  return n;
}

export function analyzePastedText(raw: string, maxChars: number): PastedSignalSummary {
  const text = normalizeText(raw, maxChars);
  const signals: PastedSignalSummary["signals"] = [];
  const inferred = new Set<CapabilityId>();

  for (const rule of [...SECRET_RULES, ...CAPABILITY_RULES, ...NEUTRAL_RULES]) {
    const count = countMatches(rule.pattern, text);
    if (count === 0) continue;
    signals.push({ id: rule.id, label: rule.label, count });
    if (rule.infers) inferred.add(rule.infers);
  }

  return { chars: text.length, signals, inferredCapabilities: [...inferred] };
}

export const hasSecretLikeContent = (summary: PastedSignalSummary | null): boolean =>
  Boolean(summary?.signals.some((s) => s.id.startsWith("secret_")));
