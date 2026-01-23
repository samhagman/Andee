/**
 * Validation utilities for query parameters and input data.
 */

/**
 * Error thrown when validation fails.
 * Can be caught and converted to a 400 response.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Parse isGroup query parameter.
 * Returns true for "true", false for "false", undefined otherwise.
 *
 * @example
 * parseIsGroup("true")   // true
 * parseIsGroup("false")  // false
 * parseIsGroup(null)     // undefined
 * parseIsGroup("yes")    // undefined
 */
export function parseIsGroup(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Parse isGroup and throw if missing/invalid (for endpoints that require it).
 *
 * @throws {ValidationError} If value is not "true" or "false"
 *
 * @example
 * requireIsGroup("true")   // true
 * requireIsGroup("false")  // false
 * requireIsGroup(null)     // throws ValidationError
 */
export function requireIsGroup(value: string | null): boolean {
  const parsed = parseIsGroup(value);
  if (parsed === undefined) {
    throw new ValidationError(
      "isGroup parameter is required and must be 'true' or 'false'"
    );
  }
  return parsed;
}

/**
 * Require a non-null string parameter.
 *
 * @throws {ValidationError} If value is null or empty
 */
export function requireString(
  value: string | null,
  paramName: string
): string {
  if (!value) {
    throw new ValidationError(`${paramName} parameter is required`);
  }
  return value;
}

/**
 * Parse an integer from a string, returning undefined if invalid.
 */
export function parseIntOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}
