// Typed domain errors. Tool handlers throw these; the ledger records the tool as
// `failed` with the message, and API routes can map them to status codes.

/** Raised when an entity would leave draft without both locales (invariant 1/6). */
export class BilingualIncompleteError extends Error {
  constructor(
    public readonly fields: string[],
    public readonly missing: Array<{ field: string; locale: 'en' | 'ja' }>,
  ) {
    super(
      `Cannot publish: both locales required. Missing: ${missing
        .map((m) => `${m.field}.${m.locale}`)
        .join(', ')}`,
    );
    this.name = 'BilingualIncompleteError';
  }
}

/** Raised when a referenced entity does not exist. */
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** Raised when an operation is invalid for the entity's current state. */
export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStateError';
  }
}
