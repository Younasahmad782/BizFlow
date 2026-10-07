import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR } from '../lib/format'
import {
  DangerButton,
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
  TextInput,
} from '../components/ui'

interface Department {
  id: string
  name: string
}

interface Role {
  id: string
  name: string
}

interface EmployeeRow {
  id: string
  employeeId: string
  name: string
  email: string | null
  phone: string | null
  title: string | null
  salary?: string
  hireDate: string | null
  isActive: boolean
  department: Department | null
  role: Role | null
}

interface ListResponse {
  data: EmployeeRow[]
  total: number
  take: number
  skip: number
  salaryVisible: boolean
}

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function EmployeeModal({
  employee,
  departments,
  roles,
  salaryVisible,
  onClose,
}: {
  employee: EmployeeRow | null
  departments: Department[]
  roles: Role[]
  salaryVisible: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: employee?.name ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    departmentId: employee?.department?.id ?? '',
    roleId: employee?.role?.id ?? '',
    title: employee?.title ?? '',
    salary: employee?.salary ?? '',
    hireDate: employee?.hireDate ? toInputDate(new Date(employee.hireDate)) : toInputDate(new Date()),
    isActive: employee?.isActive ?? true,
  })
  const [serverError, setServerError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        departmentId: form.departmentId || undefined,
        roleId: form.roleId || undefined,
        title: form.title || undefined,
        hireDate: new Date(form.hireDate),
        isActive: form.isActive,
      }
      // salary is only sent when the viewer is allowed to see it
      if (salaryVisible && form.salary !== '') payload.salary = Number(form.salary)
      if (employee) return (await api.patch(`/employees/${employee.id}`, payload)).data
      return (await api.post('/employees', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      onClose()
    },
    onError: (e) => setServerError(apiErrorMessage(e)),
  })

  const valid = form.name.trim().length >= 2

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{employee ? 'Edit employee' : 'Add employee'}</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full name">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Muhammad Saad" />
          </Field>
          <Field label="Position">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Sales Executive" />
          </Field>
          <Field label="Phone">
            <TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0300-1234567" />
          </Field>
          <Field label="Email">
            <TextInput value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="Department">
            <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">— None —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Role">
            <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">— None —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Joining date">
            <TextInput type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
          </Field>
          {salaryVisible ? (
            <Field label="Salary (Rs.)">
              <TextInput
                type="number"
                min="0"
                step="0.01"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
                placeholder="60000"
              />
            </Field>
          ) : (
            <p className="text-xs text-slate-500 self-end pb-2">
              Salary is hidden — you don't have the salary permission.
            </p>
          )}
          <Field label="Status">
            <Select value={form.isActive ? 'active' : 'inactive'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        {serverError && <div className="mt-4"><ErrorAlert message={serverError} /></div>}
        <div className="flex justify-end gap-2 mt-6">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function Employees() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState<'closed' | 'new' | EmployeeRow>('closed')
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null)
  const take = 15

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const resetFilters = () => {
    setSearch('')
    setDepartmentFilter('')
    setStatusFilter('')
    setPage(0)
  }

  const queryKey = ['employees', debouncedSearch, departmentFilter, statusFilter, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ take: String(take), skip: String(page * take) })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (departmentFilter) params.set('departmentId', departmentFilter)
      if (statusFilter) params.set('status', statusFilter)
      return (await api.get(`/employees?${params}`)).data as ListResponse
    },
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['employee-departments'],
    queryFn: async () => (await api.get('/employees/departments')).data as Department[],
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['employee-roles'],
    queryFn: async () => (await api.get('/roles')).data as Role[],
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      setDeleting(null)
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || departmentFilter || statusFilter
  const salaryVisible = data?.salaryVisible ?? false

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={data ? `${data.total} team member${data.total === 1 ? '' : 's'}` : undefined}
        action={<PrimaryButton onClick={() => setModal('new')}>Add employee</PrimaryButton>}
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <Field label="Search">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, EMP-1042, phone…"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Department">
            <Select value={departmentFilter} onChange={(e) => { setDepartmentFilter(e.target.value); setPage(0) }}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        {hasFilters && <SecondaryButton onClick={resetFilters}>Clear</SecondaryButton>}
      </div>

      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}
      {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            hasFilters ? (
              <EmptyState title="No employees match" hint="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No employees yet"
                hint="Add your team members and their roles here."
                action={<PrimaryButton onClick={() => setModal('new')}>Add your first employee</PrimaryButton>}
              />
            )
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Employee ID</th>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Department</th>
                      <th className="px-4 py-3 font-medium">Position</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      {salaryVisible && <th className="px-4 py-3 font-medium text-right">Salary</th>}
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{e.employeeId}</td>
                        <td className="px-4 py-3">
                          <Link to={`/employees/${e.id}`} className="font-medium text-brand-700 hover:underline">
                            {e.name}
                          </Link>
                          <p className="text-xs text-slate-500">{e.phone || e.email || ''}</p>
                        </td>
                        <td className="px-4 py-3">{e.department?.name ?? '—'}</td>
                        <td className="px-4 py-3">{e.title ?? '—'}</td>
                        <td className="px-4 py-3">
                          {e.role ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-brand-50 text-brand-700">
                              {e.role.name}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${e.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                            {e.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {salaryVisible && (
                          <td className="px-4 py-3 text-right tabular-nums">
                            {e.salary != null ? formatPKR(e.salary) : '—'}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button className="text-brand-600 hover:underline text-xs mr-3" onClick={() => setModal(e)}>
                            Edit
                          </button>
                          <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleting(e)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

      {modal !== 'closed' && (
        <EmployeeModal
          employee={modal === 'new' ? null : modal}
          departments={departments}
          roles={roles}
          salaryVisible={salaryVisible}
          onClose={() => setModal('closed')}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Remove employee?</h2>
            <p className="text-sm text-slate-600 mb-6">
              {deleting.name} ({deleting.employeeId}) will be removed from the team list.
            </p>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setDeleting(null)}>Cancel</SecondaryButton>
              <DangerButton disabled={del.isPending} onClick={() => del.mutate(deleting.id)}>
                {del.isPending ? 'Removing…' : 'Remove'}
              </DangerButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
