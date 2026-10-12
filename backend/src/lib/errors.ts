/** An error with an HTTP status code. Thrown by services, turned into JSON by the error handler. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
