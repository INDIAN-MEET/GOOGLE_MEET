/**
 * Error with an HTTP status code. The global error handler turns it into a
 * clean JSON response. Anything that is NOT an AppError becomes a generic 500.
 */
export class AppError extends Error {
  public readonly statusCode: number;

  /**
   * @param message Safe, user-facing message.
   * @param statusCode HTTP status to return (default 500).
   */
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}