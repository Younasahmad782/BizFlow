import { z } from 'zod'
import { isValidEmail, isValidPakistaniPhone } from './validation'

export const loginFormSchema = z.object({
  email: z.string().refine(isValidEmail, 'Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number')

export const registerFormSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name'),
    businessName: z.string().trim().min(2, 'Enter your business name'),
    email: z.string().trim().refine(isValidEmail, 'Enter a valid email address'),
    phone: z
      .string()
      .trim()
      .refine(isValidPakistaniPhone, 'Enter a valid Pakistani mobile (e.g. +92 300 1234567)'),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password'),
    city: z.string().min(1, 'Select your city'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const forgotPasswordFormSchema = z.object({
  email: z.string().trim().refine(isValidEmail, 'Enter a valid email address'),
})

export const resetPasswordFormSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export type FormErrors<T extends Record<string, unknown>> = Partial<Record<keyof T, string>>

/** Runs a zod schema against form values; returns field errors or null. */
export function validateForm<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
): Record<string, string> | null {
  const result = schema.safeParse(values)
  if (result.success) return null
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!errors[key]) errors[key] = issue.message
  }
  return errors
}
