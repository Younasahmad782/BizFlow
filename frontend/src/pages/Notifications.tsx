import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, ErrorAlert, PageHeader, SecondaryButton, Spinner } from '../components/ui'
import { api, apiErrorMessage } from '../lib/api'

interface NotificationItem {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
}

interface ListResponse {
  notifications: NotificationItem[]
  unreadCount: number
  total: number
  take: number
  skip: number
}

const PAGE_SIZE = 20

const TYPE_STYLES: Record<string, string> = {
  LOW_STOCK: 'bg-amber-100 text-amber-800',
  INVOICE_OVERDUE: 'bg-red-100 text-red-800',
  PAYMENT_RECEIVED: 'bg-green-100 text-green-800',
  ORDER_CREATED: 'bg-blue-100 text-blue-800',
  ORDER_CONFIRMED: 'bg-blue-100 text-blue-800',
  EMPLOYEE_ADDED: 'bg-slate-200 text-slate-700',
  SYSTEM: 'bg-slate-200 text-slate-700',
}

function typeLabel(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export default function Notifications() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const queryKey = ['notifications', 'list', page, unreadOnly]
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        take: String(PAGE_SIZE),
        skip: String(page * PAGE_SIZE),
      })
      if (unreadOnly) params.set('unread', 'true')
      return (await api.get(`/notifications?${params}`)).data as ListResponse
    },
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const markOne = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: invalidate,
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: invalidate,
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const items = data?.notifications ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={
          data && data.unreadCount > 0
            ? `${data.unreadCount} unread`
            : 'Low-stock alerts, payments, orders and system updates.'
        }
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setUnreadOnly((v) => !v)
                setPage(0)
              }}
              className={`text-sm rounded-md border px-3 py-1.5 ${
                unreadOnly
                  ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
              aria-pressed={unreadOnly}
            >
              Unread only
            </button>
            <SecondaryButton
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || (data?.unreadCount ?? 0) === 0}
            >
              {markAll.isPending ? 'Marking…' : 'Mark all read'}
            </SecondaryButton>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {isLoading ? (
        <Spinner label="Loading notifications…" />
      ) : items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'No unread notifications' : 'You are all caught up'}
          hint="Low-stock alerts, payments, orders and overdue invoices will appear here."
        />
      ) : (
        <>
          <ul className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg overflow-hidden">
            {items.map((n) => (
              <li
                key={n.id}
                className={`px-5 py-4 flex items-start gap-4 ${n.isRead ? '' : 'bg-brand-50/50'}`}
              >
                <span
                  className={`mt-0.5 shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${TYPE_STYLES[n.type] ?? TYPE_STYLES.SYSTEM}`}
                >
                  {typeLabel(n.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  <p className="text-sm text-slate-600 mt-0.5">{n.message}</p>
                  <p className="text-xs text-slate-400 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.isRead && (
                  <button
                    type="button"
                    onClick={() => markOne.mutate(n.id)}
                    disabled={markOne.isPending}
                    className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline disabled:opacity-50"
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <SecondaryButton disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </SecondaryButton>
              <span className="text-sm text-slate-500">
                Page {page + 1} of {totalPages}
              </span>
              <SecondaryButton
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </SecondaryButton>
            </div>
          )}
        </>
      )}
    </div>
  )
}
