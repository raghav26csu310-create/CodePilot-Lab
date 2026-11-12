import type { z } from 'zod'

import { badRequest } from './errors.ts'

export function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw badRequest(
      result.error.issues[0]?.message ?? 'The request body is invalid.',
      result.error.issues.slice(0, 6).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    )
  }
  return result.data
}
