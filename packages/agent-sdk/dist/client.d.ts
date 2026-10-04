import type { AegisConfig, ApprovalStatusResult, AuthorizationResult, AuthorizeInput, AlertResult, AllowResult, GuardInput, ConvenienceEventInput, HandshakeInput, HandshakeResult, RegisterAgentInput, RegisterAgentResult, TrackEventInput, TrackEventResult, WaitForApprovalInput } from "./types.js";
/**
 * The Aegis agent SDK. Never executes a tool or resumes agent work on its
 * own — it only tells you what Aegis decided. Your code decides what to
 * do with `ALLOW` / `BLOCK` / `REQUIRE_APPROVAL` (see the README's "safe
 * execution pattern").
 */
export declare class Aegis {
    private readonly http;
    constructor(config: AegisConfig);
    /**
     * Reports an action your agent already took. Does not ask for
     * authorization — see `authorize()` for that. Sends an Idempotency-Key
     * (yours, or one generated per call) that is reused across retries, so a
     * retry never records the event twice.
     */
    track(input: TrackEventInput): Promise<TrackEventResult>;
    /** Your agent process started a run. */
    trackAgentStarted(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent process finished a run. */
    trackAgentFinished(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent invoked a tool/integration — `tool` is required so this always shows up under the right integration. */
    trackToolCall(input: ConvenienceEventInput & {
        tool: string;
    }): Promise<TrackEventResult>;
    /** Your agent called an external API. */
    trackApiCall(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent read data (a record, a file, a query result). */
    trackDataRead(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent wrote/modified data. */
    trackDataWrite(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent sent a message (email, chat, notification, ...). */
    trackMessageSent(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent hit an error. Defaults `status` to "FAILURE" — pass your own to override. */
    trackError(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /** Your agent's own permissions/scopes changed. */
    trackPermissionChanged(input: ConvenienceEventInput): Promise<TrackEventResult>;
    /**
     * Asks Aegis whether your agent may perform an action. Auto-generates a
     * traceId if you don't supply one, and an Idempotency-Key per call (reused
     * across this call's retries) so a retry can never create a duplicate
     * evaluation or approval request. Pass `approvalRequestId` to use an
     * APPROVED approval for its single execution.
     */
    authorize(input: AuthorizeInput): Promise<AuthorizationResult>;
    /** Fetches the current state of a REQUIRE_APPROVAL decision without waiting. */
    getApprovalStatus(approvalRequestId: string): Promise<ApprovalStatusResult>;
    /**
     * Polls approval status with capped exponential backoff until it's no
     * longer PENDING, or `timeoutMs` elapses (default 120s — this never
     * waits forever unless you explicitly ask it to via a very large
     * value). Throws `AegisTimeoutError` on timeout or abort, never
     * resolves with a stale PENDING result.
     */
    waitForApproval(input: WaitForApprovalInput): Promise<ApprovalStatusResult>;
    /**
     * In-process enforcement for one tool call (0.7.0): authorize, run `fn` only on an allowing decision,
     * and report the outcome under that decision. Fails CLOSED by default. It guards the calls you route
     * through it — it cannot stop code that calls the tool directly. See the README's "guard()" section.
     */
    guard<T>(input: GuardInput, fn: (decision: AllowResult | AlertResult | null) => Promise<T> | T): Promise<T>;
    /**
     * Tells Aegis "this agent is up and reachable with this credential" (0.8.0). Aegis marks the connection
     * established only because this authenticated request actually arrived; it is idempotent, so calling it on every
     * start is safe. Needs a key bound to one agent (the one the dashboard issued when you connected the agent).
     */
    handshake(input?: HandshakeInput): Promise<HandshakeResult>;
    /** Lightweight auto-provisioning so a new agent doesn't need a dashboard visit before its first event/authorize call. */
    registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult>;
}
//# sourceMappingURL=client.d.ts.map