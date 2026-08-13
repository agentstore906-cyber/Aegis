import type { ApprovalStatus } from "@prisma/client";

export class ApprovalNotFoundError extends Error {
  constructor() {
    super("Approval request not found.");
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalAlreadyResolvedError extends Error {
  constructor(public readonly currentStatus: ApprovalStatus) {
    super(`This request was already ${currentStatus.toLowerCase()} — it cannot be resolved again.`);
    this.name = "ApprovalAlreadyResolvedError";
  }
}

export class ApprovalExpiredError extends Error {
  constructor() {
    super("This approval request has expired and can no longer be resolved.");
    this.name = "ApprovalExpiredError";
  }
}
