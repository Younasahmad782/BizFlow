import { z } from 'zod'
import { pakistaniPhone } from './common'

// At least 8 chars, with a letter and a number
export const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number')

export const registerSchema = z.object({
  organization: z.object({
    name: z.string().min(2, 'Business name is required').max(120),
    city: z.string().max(60).optional(),
    province: z.string().max(60).optional(),
    category: z.string().max(60).optional(),
    phone: pakistaniPhone,
    address: z.string().max(255).optional(),
  }),
  user: z.object({
    name: z.string().min(2, 'Your full name is required').max(120),
    email: z.string().email('Enter a valid email address'),
    password: strongPassword,
  }),
})

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const createMemberSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email('Enter a valid email address'),
  password: strongPassword,
  roleId: z.string().min(1, 'Role is required'),
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: strongPassword,
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: strongPassword,
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
