import { z } from 'zod'

// Pakistani mobile: +92 300 1234567, 0300-1234567, 03001234567, +923001234567
export const pakistaniPhone = z
  .string()
  .regex(/^(?:\+92|0)?\s*3\d{2}[\s-]?\d{7}$/, 'Enter a valid Pakistani mobile number (e.g. +92 300 1234567)')
  .optional()

export const email = z.string().email('Enter a valid email address').optional()

export const pkrAmount = z.number().positive('Amount must be greater than zero')

export const optionalPkrAmount = z.number().positive('Amount must be greater than zero').optional()

export const pagination = z.object({
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
})
