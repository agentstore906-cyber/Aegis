export class LastOwnerError extends Error {
  constructor() {
    super("An organization must always have at least one Owner.");
    this.name = "LastOwnerError";
  }
}

export class PrivilegeEscalationError extends Error {
  constructor() {
    super("Only an Owner can grant, change, or remove the Owner role.");
    this.name = "PrivilegeEscalationError";
  }
}

export class MemberNotFoundError extends Error {
  constructor() {
    super("Member not found in this organization.");
    this.name = "MemberNotFoundError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super("Invitation not found.");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends Error {
  constructor() {
    super("This invitation has expired.");
    this.name = "InvitationExpiredError";
  }
}
