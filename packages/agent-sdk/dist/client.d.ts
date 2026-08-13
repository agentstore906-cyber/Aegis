import type { AegisConfig, ApprovalStatusResult, AuthorizationResult, AuthorizeInput, RegisterAgentInput, RegisterAgentResult, TrackEventInput, TrackEventResult, WaitForApprovalInput } from "./types.js";
/**
 * The Aegis agent SDK. Never executes a tool or resumes agent work on its
 * own — it only tells you what Aegis decided. Your code decides what to
 * do with `ALLOW` / `BLOCK` / `REQUIRE_APPROVAL` (see the README's "safe
 * execution pattern").
 */
export declare class Aegis {
    private readonly http;
    constructor(config: AegisConfig);
    /** Reports an action your agent already took. Does not ask for authorization — see `authorize()` for that. */
    track(input: TrackEventInput): Promise<TrackEventResult>;
    /** Asks Aegis whether your agent may perform an action. Auto-generates a traceId if you don't supply one. */
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
    /** Lightweight auto-provisioning so a new agent doesn't need a dashboard visit before its first event/authorize call. */
    registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult>;
}
//# sourceMappingURL=client.d.ts.map