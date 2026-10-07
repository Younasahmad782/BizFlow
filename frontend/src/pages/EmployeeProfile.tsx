import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import { ErrorAlert, PageHeader, Spinner } from '../components/ui'

interface EmployeeProfile {
  id: string
  employeeId: string
  name: string
  email: string | null
  phone: string | null
  title: string | null
  salary?: string
  hireDate: string | null
  isActive: boolean
  department: { id: string; name: string } | null
  role: { id: string; name: string } | null
  salaryVisible: boolean
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value}</span>
    </div>
  )
}

export default function EmployeeProfile() {
  const { id } = useParams()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['employee-profile', id],
    queryFn: async () => (await api.get(`/employees/${id}`)).data as EmployeeProfile,
    enabled: !!id,
  })

  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  if (isError || !data) return <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div>
      <PageHeader
        title={data.name}
        subtitle={`${data.employeeId} · ${data.title ?? 'No position set'}`}
        action={
          <Link to="/employees" className="text-sm text-brand-600 hover:underline">
            ← All employees
          </Link>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-semibold text-slate-900 mb-2">Personal details</h3>
          <DetailRow label="Employee ID" value={data.employeeId} />
          <DetailRow label="Full name" value={data.name} />
          <DetailRow label="Phone" value={data.phone ?? '—'} />
          <DetailRow label="Email" value={data.email ?? '—'} />
          <DetailRow
            label="Status"
            value={data.isActive ? 'Active' : 'Inactive'}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="font-semibold text-slate-900 mb-2">Employment</h3>
          <DetailRow label="Department" value={data.department?.name ?? '—'} />
          <DetailRow label="Position" value={data.title ?? '—'} />
          <DetailRow label="System role" value={data.role?.name ?? '—'} />
          <DetailRow label="Joining date" value={formatPKDate(data.hireDate)} />
          {data.salaryVisible ? (
            <DetailRow label="Salary" value={data.salary != null ? formatPKR(data.salary) : '—'} />
          ) : (
            <p className="text-xs text-slate-500 mt-3">
              Salary is hidden — you don't have the salary permission.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
