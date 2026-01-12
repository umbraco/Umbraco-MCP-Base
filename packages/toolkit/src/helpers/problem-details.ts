/**
 * Problem Details (RFC 7807)
 *
 * Standard interface for API error responses.
 * This format is used by Umbraco APIs and many other REST APIs.
 */

/**
 * RFC 7807 Problem Details format for API errors.
 */
export interface ProblemDetails {
  /** A URI reference that identifies the problem type */
  type?: string;
  /** A short, human-readable summary of the problem type */
  title?: string;
  /** The HTTP status code */
  status?: number;
  /** A human-readable explanation specific to this occurrence of the problem */
  detail?: string;
  /** A URI reference that identifies the specific occurrence of the problem */
  instance?: string;
  /** Allow additional properties per RFC 7807 */
  [key: string]: unknown;
}
