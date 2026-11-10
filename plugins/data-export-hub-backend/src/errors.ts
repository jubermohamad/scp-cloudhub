export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

/** Converts a PostgreSQL unique violation into a ConflictError; rethrows anything else. */
export function mapUniqueViolation(error: unknown, message: string): never {
  if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
    throw new ConflictError(message);
  }
  throw error;
}
