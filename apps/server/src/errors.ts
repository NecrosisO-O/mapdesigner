import type { ValidationIssue } from "@mapdesigner/map-core";

export type ServiceErrorCode =
  | "bad_request"
  | "map_not_found"
  | "validation_failed"
  | "revision_conflict"
  | "storage_error";

export class ServiceError extends Error {
  code: ServiceErrorCode;
  statusCode: number;
  issues: ValidationIssue[];

  constructor(input: {
    code: ServiceErrorCode;
    message: string;
    statusCode: number;
    issues?: ValidationIssue[];
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ServiceError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.issues = input.issues ?? [];
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function badRequest(message: string, issues: ValidationIssue[] = []): ServiceError {
  return new ServiceError({
    code: "bad_request",
    message,
    statusCode: 400,
    issues
  });
}

export function validationFailed(message: string, issues: ValidationIssue[]): ServiceError {
  return new ServiceError({
    code: "validation_failed",
    message,
    statusCode: 400,
    issues
  });
}

export function notFound(message: string, cause?: unknown): ServiceError {
  return new ServiceError({
    code: "map_not_found",
    message,
    statusCode: 404,
    cause
  });
}

export function revisionConflict(message: string): ServiceError {
  return new ServiceError({
    code: "revision_conflict",
    message,
    statusCode: 409
  });
}

export function storageError(message: string, cause?: unknown): ServiceError {
  return new ServiceError({
    code: "storage_error",
    message,
    statusCode: 500,
    cause
  });
}
