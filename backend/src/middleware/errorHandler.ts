import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../utils/errors'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    })
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    })
  }

  // Prisma: unique constraint / record not found → friendly codes
  const code = (err as { code?: string })?.code
  if (code === 'P2002') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with these details already exists' },
    })
  }
  if (code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } })
  }
  // P2023: malformed ID (e.g. invalid UUID in a path parameter)
  if (code === 'P2023') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid ID format' } })
  }

  // Malformed JSON body (body-parser SyntaxError)
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON in request body' },
    })
  }

  console.error(err)
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  })
}
