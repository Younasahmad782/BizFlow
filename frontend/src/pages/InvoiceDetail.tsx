import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import {
  ErrorAlert,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Spinner,
} from '../components/ui'

interface InvoiceDetailData {
  invoice: {
    id: string
    invoiceNumber: string
    issueDate: string
    dueDate: string | null
    subtotal: string
    discountAmount: string
    taxAmount: string | null
    totalAmount: string
    notes: string | null
    items: { description: string; quantity: number; unitPrice: string }[]
  }
  customer: {
    name: string
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
  }
  business: {
    name: string
    address: string | null
    phone: string | null
    email: string | null
  }
  paidAmount: number
  balanceDue: number
  derivedStatus: string
}

interface ShareData {
  invoiceNumber: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  message: string
  pdfUrl: string
  emailSubject: string
  note: string
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SENT: 'bg-blue-100 text-blue-800',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
}

function ShareDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['invoice-share', invoiceId],
    queryFn: async () => (await api.get(`/invoices/${invoiceId}/share`)).data as ShareData,
  })
  const [copied, setCopied] = useState(false)

  const copyMessage = async () => {
    if (!data) return
    await navigator.clipboard.writeText(data.message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const whatsappUrl = data?.customerPhone
    ? `https://wa.me/${data.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(data.message)}`
    : null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-1">Share invoice</h2>
        <p className="text-sm text-slate-500 mb-4">
          Email is not configured — share the message or PDF manually.
        </p>
        {isLoading && <Spinner />}
        {data && (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 mb-4">
              <pre className="text-sm whitespace-pre-wrap font-sans">{data.message}</pre>
            </div>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton onClick={copyMessage}>
                {copied ? 'Copied!' : 'Copy message'}
              </SecondaryButton>
              {whatsappUrl && (
                <a href={whatsappUrl} target="_blank" rel="noreferrer">
                  <SecondaryButton>Open in WhatsApp</SecondaryButton>
                </a>
              )}
              {data.customerEmail && (
                <a
                  href={`mailto:${data.customerEmail}?subject=${encodeURIComponent(data.emailSubject)}&body=${encodeURIComponent(data.message)}`}
                >
                  <SecondaryButton>Open email app</SecondaryButton>
                </a>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-4">{data.note}</p>
          </>
        )}
        <div className="flex justify-end mt-6">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    </div>
  )
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const [shareOpen, setShareOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['invoice-detail', id],
    queryFn: async () => (await api.get(`/invoices/${id}`)).data as InvoiceDetailData,
    enabled: !!id,
  })

  const downloadPdf = async () => {
    if (!id || !data) return
    setDownloading(true)
    try {
      const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${data.invoice.invoiceNumber}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  if (isError || !data) return <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />

  const { invoice, customer, business } = data

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={invoice.invoiceNumber}
          action={
            <Link to="/invoices" className="text-sm text-brand-600 hover:underline">
              ← All invoices
            </Link>
          }
        />
        <div className="flex flex-wrap gap-2 mb-6">
          <PrimaryButton onClick={() => window.print()}>Print</PrimaryButton>
          <SecondaryButton onClick={downloadPdf} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download PDF'}
          </SecondaryButton>
          <SecondaryButton onClick={() => setShareOpen(true)}>Share</SecondaryButton>
          <span
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_BADGE[data.derivedStatus] ?? 'bg-slate-100 text-slate-600'}`}
          >
            {data.derivedStatus.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Printable invoice document */}
      <div className="bg-white border border-slate-200 rounded-lg p-8 max-w-3xl print:border-0 print:rounded-none print:p-0 print:max-w-none">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{business.name}</h1>
            {business.address && <p className="text-sm text-slate-500 mt-1">{business.address}</p>}
            <p className="text-sm text-slate-500">
              {[business.phone, business.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-slate-900">INVOICE</p>
            <p className="font-mono text-sm text-slate-600">{invoice.invoiceNumber}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Bill to</p>
            <p className="font-semibold">{customer.name}</p>
            {customer.address && <p className="text-sm text-slate-600">{customer.address}</p>}
            {customer.city && <p className="text-sm text-slate-600">{customer.city}</p>}
            {customer.phone && <p className="text-sm text-slate-600">{customer.phone}</p>}
            {customer.email && <p className="text-sm text-slate-600">{customer.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Invoice date</p>
            <p className="text-sm mb-2">{formatPKDate(invoice.issueDate)}</p>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Due date</p>
            <p className="text-sm">{formatPKDate(invoice.dueDate)}</p>
          </div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium text-right">Qty</th>
              <th className="py-2 font-medium text-right">Unit price</th>
              <th className="py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td className="py-2.5">{item.description}</td>
                <td className="py-2.5 text-right tabular-nums">{item.quantity}</td>
                <td className="py-2.5 text-right tabular-nums">{formatPKR(item.unitPrice)}</td>
                <td className="py-2.5 text-right tabular-nums font-medium">
                  {formatPKR(Number(item.unitPrice) * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <dl className="text-sm w-64 space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular-nums">{formatPKR(invoice.subtotal)}</dd>
            </div>
            {Number(invoice.discountAmount) > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Discount</dt>
                <dd className="tabular-nums">− {formatPKR(invoice.discountAmount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Tax</dt>
              <dd className="tabular-nums">{formatPKR(invoice.taxAmount ?? 0)}</dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200 text-base font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatPKR(invoice.totalAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Paid</dt>
              <dd className="tabular-nums text-green-700">{formatPKR(data.paidAmount)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Balance due</dt>
              <dd className={`tabular-nums ${data.balanceDue > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {formatPKR(data.balanceDue)}
              </dd>
            </div>
          </dl>
        </div>

        {invoice.notes && (
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Notes</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        <p className="text-center text-sm text-slate-400 mt-8">
          Thank you for your business.
        </p>
      </div>

      {shareOpen && id && <ShareDialog invoiceId={id} onClose={() => setShareOpen(false)} />}
    </div>
  )
}
