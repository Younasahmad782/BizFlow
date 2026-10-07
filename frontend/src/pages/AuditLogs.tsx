import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKDateTime } from '../lib/format'
import {
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  SecondaryButton,
  Select,
  Spinner,
  TextInput,
} from '../components/ui'

interface AuditEntry {
  id: string
  actor: string
  action: string
  entity: string
  entityId: string | null
  details: unknown
  createdAt: string
  summary: string
}

interface ListResponse {
  data: AuditEntry[]
  total: number
  take: number
  skip: number
}

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ROLE_CHANGE', 'PASSWORD_CHANGE']
const ENTITIES = [
  'Order',
  'Payment',
  'Invoice',
  'Product',
  'Customer',
  'Supplier',
  'Employee',
  'Expense',
  'Inventory',
  'OrganizationMember',
]

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-slate-100 text-slate-700',
  LOGOUT: 'bg-slate-100 text-slate-600',
  ROLE_CHANGE: 'bg-purple-100 text-purple-800',
  PASSWORD_CHANGE: 'bg-amber-100 text-amber-800',
}

export default function AuditLogs() {
  const [actor, setActor] = useState('')
  const [debouncedActor, setDebouncedActor] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const take = 20

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedActor(actor)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [actor])

  const resetFilters = () => {
    setActor('')
    setActionFilter('')
    setEntityFilter('')
    setFrom('')
    setTo('')
    setPage(0)
  }

  const queryKey = ['audit-logs', debouncedActor, actionFilter, entityFilter, from, to, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ take: String(take), skip: String(page * take) })
      if (debouncedActor) params.set('actor', debouncedActor)
      if (actionFilter) params.set('action', actionFilter)
      if (entityFilter) params.set('entity', entityFilter)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return (await api.get(`/audit-logs?${params}`)).data as ListResponse
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedActor || actionFilter || entityFilter || from || to

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle={data ? `${data.total} recorded action${data.total === 1 ? '' : 's'}` : undefined}
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[160px]">
          <Field label="Actor">
            <TextInput
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="Search by name…"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Action">
            <Select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{a.replace('_', ' ')}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="Entity">
            <Select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(0) }}>
              <option value="">All entities</option>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} />
          </Field>
        </div>
        <div className="w-36">
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} />
          </Field>
        </div>
        {hasFilters && <SecondaryButton onClick={resetFilters}>Clear</SecondaryButton>}
      </div>

      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}
      {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'No matching activity' : 'No activity recorded yet'}
              hint={
                hasFilters
                  ? 'Try a different search or clear the filters.'
                  : 'Actions like logins, orders, payments and inventory changes will appear here.'
              }
            />
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                {data.data.map((entry) => (
                  <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ACTION_BADGE[entry.action] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {entry.action.replace('_', ' ')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-900">{entry.summary}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatPKDateTime(entry.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-slate-500">Page {page + 1} of {totalPages}</p>
                  <div className="flex gap-2">
                    <SecondaryButton disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</SecondaryButton>
                    <SecondaryButton disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</SecondaryButton>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
