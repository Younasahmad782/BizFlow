import { QueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const TOKEN_KEY = 'bizflow_token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

// All API calls go through /api (proxied to the backend in dev,
// served by nginx in Docker)
export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      setToken(null)
      const expired = error.response?.data?.error?.code === 'SESSION_EXPIRED'
      window.location.href = expired ? '/login?expired=1' : '/login'
    }
    return Promise.reject(error)
  },
)

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string; details?: { field: string; message: string }[] } } | undefined
    if (data?.error?.details?.length) {
      return data.error.details.map((d) => `${d.field}: ${d.message}`).join('; ')
    }
    if (data?.error?.message) return data.error.message
    return error.message
  }
  return 'Something went wrong'
}
