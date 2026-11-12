export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'invalid_request', message, details)
}

export function unauthorized(message = 'Sign in to continue.'): ApiError {
  return new ApiError(401, 'unauthorized', message)
}

export function forbidden(message = 'That action is not allowed.'): ApiError {
  return new ApiError(403, 'forbidden', message)
}

export function notFound(message = 'Not found.'): ApiError {
  return new ApiError(404, 'not_found', message)
}

export function conflict(message: string): ApiError {
  return new ApiError(409, 'conflict', message)
}

export function tooManyRequests(message: string, details?: unknown): ApiError {
  return new ApiError(429, 'rate_limited', message, details)
}

export function serviceUnavailable(message: string): ApiError {
  return new ApiError(503, 'unavailable', message)
}
