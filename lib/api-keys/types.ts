export class MissingApiKeyError extends Error {
  constructor() {
    super("No API key was provided.");
    this.name = "MissingApiKeyError";
  }
}

export class InvalidApiKeyError extends Error {
  constructor() {
    super("The provided API key is invalid.");
    this.name = "InvalidApiKeyError";
  }
}

export class RevokedApiKeyError extends Error {
  constructor() {
    super("This API key has been revoked.");
    this.name = "RevokedApiKeyError";
  }
}

export class ExpiredApiKeyError extends Error {
  constructor() {
    super("This API key has expired.");
    this.name = "ExpiredApiKeyError";
  }
}

export class InsufficientScopeError extends Error {
  constructor(public readonly requiredScope: string) {
    super(`This API key does not have the required scope: ${requiredScope}.`);
    this.name = "InsufficientScopeError";
  }
}
