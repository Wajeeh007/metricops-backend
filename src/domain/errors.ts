export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () => new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
export const forbidden = () => new AppError(403, "PERMISSION_DENIED", "You do not have permission to perform this action");
export const notFound = (resource: string) => new AppError(404, "NOT_FOUND", `${resource} was not found`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const invalid = (code: string, message: string) => new AppError(400, code, message);
