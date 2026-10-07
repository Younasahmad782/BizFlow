import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api, queryClient } from '../lib/api'
import { connectNotifications, disconnectNotifications } from '../lib/socket'

const NAV: Array<{ to: string; label: string; end?: boolean; perm?: string }> = [
  { to: '/', label: 'Dashboard', end: true, perm: 'reports.read' },
  { to: '/customers', label: 'Customers', perm: 'customers.read' },
  { to: '/products', label: 'Products', perm: 'products.read' },
  { to: '/inventory', label: 'Inventory', perm: 'products.read' },
  { to: '/suppliers', label: 'Suppliers', perm: 'products.read' },
  { to: '/sales', label: 'Sales', perm: 'orders.read' },
  { to: '/orders', label: 'Orders', perm: 'orders.read' },
  { to: '/invoices', label: 'Invoices', perm: 'invoices.read' },
  { to: '/expenses', label: 'Expenses', perm: 'expenses.read' },
  { to: '/employees', label: 'Employees', perm: 'employees.read' },
  { to: '/reports', label: 'Reports', perm: 'reports.read' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/assistant', label: 'AI Assistant' },
  { to: '/settings', label: 'Settings', perm: 'settings.manage' },
  { to: '/audit-logs', label: 'Audit Logs', perm: 'audit_logs.read' },
]

export default function Layout() {
  const { member, organization, memberships, switchOrganization, logout, can } = useAuth()
  const [switching, setSwitching] = useState(false)
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications?take=1')).data as { unreadCount: number },
    refetchInterval: 60_000,
  })
  const unread = notifData?.unreadCount ?? 0
  const otherOrgs = (memberships ?? []).filter((m) => m.organizationId !== organization?.id)

  // Real-time notifications: refresh the badge/list the moment one arrives.
  useEffect(() => {
    if (member) {
      connectNotifications(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      })
    } else {
      disconnectNotifications()
    }
  }, [member])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top navigation */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-lg tracking-tight">
            BIZ<span className="text-brand-600">FLOW</span>
          </span>
          {organization && (
            <span className="text-sm text-slate-500 border-l border-slate-200 pl-3 flex items-center gap-2">
              {organization.name}
              {otherOrgs.length > 0 && (
                <select
                  aria-label="Switch business"
                  className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white text-slate-700"
                  value=""
                  disabled={switching}
                  onChange={async (e) => {
                    if (!e.target.value) return
                    setSwitching(true)
                    try {
                      await switchOrganization(e.target.value)
                    } finally {
                      setSwitching(false)
                      e.target.value = ''
                    }
                  }}
                >
                  <option value="">{switching ? 'Switching…' : 'Switch business'}</option>
                  {otherOrgs.map((m) => (
                    <option key={m.organizationId} value={m.organizationId}>
                      {m.organizationName} ({m.roleName})
                    </option>
                  ))}
                </select>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <NavLink
            to="/notifications"
            className="relative text-sm text-slate-600 hover:text-slate-900"
          >
            Notifications
            {unread > 0 && (
              <span className="absolute -top-2 -right-3 bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">
                {unread}
              </span>
            )}
          </NavLink>
          <span className="text-sm text-slate-600">
            {member?.name} <span className="text-slate-400">({member?.role.name})</span>
          </span>
          <button onClick={logout} className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Log out
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Left sidebar */}
        <aside className="w-56 shrink-0 bg-slate-900 text-slate-200 flex flex-col">
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {NAV.filter((item) => !item.perm || can(item.perm)).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `block px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
            Simple business management
            <br />
            for growing Pakistani businesses.
          </div>
        </aside>

        <main className="flex-1 p-8 max-w-6xl w-full">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
