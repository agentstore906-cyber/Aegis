/**
 * A minimal, disposable EXTERNAL agent used by the Connect Agent end-to-end test
 * (lib/agents/__tests__/real-agent-e2e.integration.test.ts). It is a separate OS process that knows
 * nothing about Aegis internals: it is given a base URL, an agent slug and the credential Aegis issued,
 * and it talks to Aegis over real HTTP using the published SDK — exactly what a customer's agent does.
 *
 * Prints ONE line of JSON describing what happened, so the test can assert on it.
 *
 * The agent NEVER sends an agent identifier: the credential says which agent it is (AEGIS_AGENT is only a label for the output).
 *   AEGIS_BASE_URL, AEGIS_API_KEY, AEGIS_AGENT   required
 *   AEGIS_BLOCKED_ACTION                          an action the org's policy blocks (optional)
 */
import { Aegis, AegisBlockedError } from "../../packages/agent-sdk/dist/index.js";

const { AEGIS_BASE_URL, AEGIS_API_KEY, AEGIS_AGENT, AEGIS_BLOCKED_ACTION } = process.env;
const aegis = new Aegis({ baseUrl: AEGIS_BASE_URL, apiKey: AEGIS_API_KEY, maxRetries: 0 });
const out = { agent: AEGIS_AGENT };

try {
  out.handshake = await aegis.handshake({ sdkVersion: "e2e", framework: "node-script" });

  out.event = await aegis.track({
    eventType: "TOOL_CALL",
    action: "crm.lookup",
    resource: "customer:42",
    tool: "crm",
    clientEventId: `e2e-${AEGIS_AGENT}-first`,
    description: "e2e first real event",
  });

  out.allowed = await aegis.authorize({ action: "crm.lookup", resource: "customer:42", tool: "crm" });

  // Enforcement: a guarded tool call that Aegis blocks must never run the tool body.
  let toolRan = false;
  let blocked = null;
  if (AEGIS_BLOCKED_ACTION) {
    try {
      await aegis.guard({ action: AEGIS_BLOCKED_ACTION, resource: "customer:42", tool: "crm" }, async () => {
        toolRan = true;
      });
    } catch (error) {
      blocked = error instanceof AegisBlockedError ? { name: error.name, reason: error.message } : { name: error?.name, message: String(error) };
    }
    // An agent that does NOT route the call through guard() is simply not stopped — Aegis only recorded a decision.
    let unguardedRan = false;
    const decision = await aegis.authorize({ action: AEGIS_BLOCKED_ACTION, resource: "customer:42", tool: "crm" });
    if (decision.decision === "BLOCK") unguardedRan = true; // the agent ignores the BLOCK and runs the tool anyway
    out.enforcement = { decision: decision.decision, guardedToolRan: toolRan, guardedBlocked: blocked, ignoringAgentToolRan: unguardedRan };
  }
  out.ok = true;
} catch (error) {
  out.ok = false;
  out.error = { name: error?.name, status: error?.status, code: error?.code, message: String(error?.message ?? error) };
}
console.log(JSON.stringify(out));
