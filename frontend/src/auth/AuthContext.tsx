import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, queryClient, setToken } from '../lib/api'

export interface Member {
  id: string
  organizationId: string
  name: string
  email: string
  isActive: boolean
  role: { id: string; name: string }
}

export interface Organization {
  id: string
  name: string
  city?: string
  province?: string
  category?: string
}

export interface Membership {
  memberId: string
  organizationId: string
  organizationName: string
  roleName: string
}

interface AuthState {
  member: Member | null
  organization: Organization | null
  permissions: string[]
  loading: boolean
  /** Set when login found several memberships — user must pick one. */
  pendingOrgs: Membership[] | null
  /** All active memberships of the signed-in user (for the org switcher). */
  memberships: Membership[] | null
  can: (key: string) => boolean
  login: (email: string, password: string) => Promise<void>
  selectOrganization: (organizationId: string) => Promise<void>
  /** Switch orgs while logged in. Refetches /auth/me memberships via the header. */
  switchOrganization: (organizationId: string) => Promise<void>
  register: (orgName: string, name: string, email: string, password: string, city?: string, province?: string, phone?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<Member | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // Short-lived token from login when several memberships exist.
  const [selectToken, setSelectToken] = useState<string | null>(null)
  const [pendingOrgs, setPendingOrgs] = useState<Membership[] | null>(null)
  const [memberships, setMemberships] = useState<Membership[] | null>(null)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get('/auth/me')
      .then((res) => {
        setMember(res.data.member)
        setOrganization(res.data.organization)
        setPermissions(res.data.permissions ?? [])
        setMemberships(res.data.memberships ?? null)
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const applySession = useCallback((data: {
    token: string
    member: Member
    organization: Organization
    permissions?: string[]
  }) => {
    setToken(data.token)
    setMember(data.member)
    setOrganization(data.organization)
    setPermissions(data.permissions ?? [])
  }, [])

  const refreshMemberships = useCallback(async () => {
    try {
      const res = await api.get('/auth/me')
      setMemberships(res.data.memberships ?? null)
    } catch {
      // not fatal — switcher just won't list other orgs
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password })
    if (res.data.requiresOrgSelection) {
      // Several memberships — hold the select token, UI shows the picker.
      setSelectToken(res.data.selectToken as string)
      setPendingOrgs(res.data.memberships as Membership[])
      return
    }
    applySession(res.data)
    await refreshMemberships()
  }, [applySession, refreshMemberships])

  const selectOrganization = useCallback(
    async (organizationId: string) => {
      if (!selectToken) throw new Error('Session expired. Please sign in again.')
      const res = await api.post(
        '/auth/switch-organization',
        { organizationId },
        { headers: { Authorization: `Bearer ${selectToken}` } },
      )
      setSelectToken(null)
      setPendingOrgs(null)
      applySession(res.data)
      await refreshMemberships()
    },
    [selectToken, applySession, refreshMemberships],
  )

  /** Switch organizations while already logged in (uses the session token). */
  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const res = await api.post('/auth/switch-organization', { organizationId })
      applySession(res.data)
      queryClient.invalidateQueries()
    },
    [applySession],
  )

  const register = useCallback(
    async (orgName: string, name: string, email: string, password: string, city?: string, province?: string, phone?: string) => {
      const res = await api.post('/auth/register', {
        organization: { name: orgName, city, province, phone },
        user: { name, email, password },
      })
      applySession(res.data)
      await refreshMemberships()
    },
    [applySession, refreshMemberships],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // session may already be invalid — still clear local state
    }
    setToken(null)
    setSelectToken(null)
    setPendingOrgs(null)
    setMemberships(null)
    setMember(null)
    setOrganization(null)
    setPermissions([])
    window.location.href = '/login'
  }, [])

  const can = useCallback(
    (key: string) => permissions.includes('*') || permissions.includes(key),
    [permissions],
  )

  return (
    <AuthContext.Provider
      value={{ member, organization, permissions, loading, pendingOrgs, memberships, can, login, selectOrganization, switchOrganization, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
