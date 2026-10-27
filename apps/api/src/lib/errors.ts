import { ERROR_CODES, HTTP_STATUS } from '@admin/shared';

export interface ApiErrorDetails {
  field?: string;
  message: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ApiErrorDetails[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ApiErrorDetails[]
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export class ValidationError extends ApiError {
  constructor(details: ApiErrorDetails[]) {
    super(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      'Validation failed',
      details
    );
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required') {
    super(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTHENTICATION_ERROR, message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ApiError {
  constructor(message = 'Access denied') {
    super(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTHORIZATION_ERROR, message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(resource = 'Resource') {
    super(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(HTTP_STATUS.CONFLICT, ERROR_CODES.CONFLICT, message);
    this.name = 'ConflictError';
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string) {
    super(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, message);
    this.name = 'BadRequestError';
  }
}


export class InvalidTokenError extends ApiError {
  constructor(message = 'Invalid or expired token') {
    super(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.INVALID_TOKEN, message);
    this.name = 'InvalidTokenError';
  }
}

export class InvalidCredentialsError extends ApiError {
  constructor() {
    super(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_CREDENTIALS,
      'Invalid email or password'
    );
    this.name = 'InvalidCredentialsError';
  }
}

export class AccountLockedError extends ApiError {
  constructor(minutes: number) {
    super(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.ACCOUNT_LOCKED,
      `Account is locked. Try again in ${minutes} minutes.`
    );
    this.name = 'AccountLockedError';
  }
}

export class TwoFactorRequiredError extends ApiError {
  public readonly twoFactorToken: string;

  constructor(twoFactorToken: string) {
    super(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.TWO_FACTOR_REQUIRED,
      'Two-factor authentication required'
    );
    this.name = 'TwoFactorRequiredError';
    this.twoFactorToken = twoFactorToken;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        twoFactorToken: this.twoFactorToken,
      },
    };
  }
}

export class RateLimitError extends ApiError {
  constructor() {
    super(
      429,
      ERROR_CODES.RATE_LIMIT_ERROR,
      'Too many requests. Please try again later.'
    );
    this.name = 'RateLimitError';
  }
}
