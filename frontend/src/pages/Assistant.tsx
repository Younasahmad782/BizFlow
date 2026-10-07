import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { ErrorAlert, PageHeader, PrimaryButton, Spinner, TextInput } from '../components/ui'

interface Source {
  label: string
  value: string
}

interface AskResponse {
  answer: string
  sources: Source[]
  provider: string
  period: string
  disclaimer: string
}

interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
  period?: string
}

const SUGGESTIONS = [
  'What were my best-selling products this month?',
  'How much revenue did we make last month?',
  'Which invoices are overdue?',
  'Which products are low in stock?',
  'What category generated the most sales?',
  'Compare this month with last month.',
  "Give me a short summary of this month's business performance.",
]

export default function Assistant() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: context } = useQuery({
    queryKey: ['assistant', 'context'],
    queryFn: async () => (await api.get('/assistant/context')).data as {
      period: string
      orderCount: number
      revenue: number
      topProductCount: number
      lowStockCount: number
      overdueCount: number
    },
  })

  const ask = useMutation({
    mutationFn: async (question: string) =>
      (await api.post('/assistant/ask', { question })).data as AskResponse,
    onSuccess: (res) => {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: res.answer, sources: res.sources, period: res.period },
      ])
    },
    onError: (e) => {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `Sorry — ${apiErrorMessage(e)}` },
      ])
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, ask.isPending])

  const send = (text: string) => {
    const q = text.trim()
    if (!q || ask.isPending) return
    setMessages((m) => [...m, { role: 'user', text: q }])
    setInput('')
    ask.mutate(q)
  }

  return (
    <div>
      <PageHeader
        title="AI Business Assistant"
        subtitle={
          context
            ? `Answering from your ${context.period} records (${context.orderCount} orders).`
            : 'Answering from your business records.'
        }
      />

      <div className="bg-white border border-slate-200 rounded-lg flex flex-col" style={{ height: '62vh' }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="py-6">
              <p className="text-sm text-slate-600 mb-3">
                Ask about your sales, revenue, invoices, stock and expenses. Answers come only
                from your organization's records — never invented.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full px-3 py-1.5 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-900'
                }`}
              >
                <p>{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-200">
                    <p className="text-xs font-semibold text-slate-500 mb-1.5">Source context</p>
                    <dl className="space-y-1">
                      {m.sources.map((s, j) => (
                        <div key={j} className="flex justify-between gap-4 text-xs">
                          <dt className="text-slate-500">{s.label}</dt>
                          <dd className="font-semibold tabular-nums">{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {m.period && (
                      <p className="text-xs text-slate-400 mt-1.5">Period: {m.period}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {ask.isPending && (
            <div className="flex justify-start">
              <div className="bg-slate-100 rounded-lg px-4 py-2.5">
                <Spinner />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-200 p-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <div className="flex-1">
              <TextInput
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your business…"
                disabled={ask.isPending}
              />
            </div>
            <PrimaryButton type="submit" disabled={!input.trim() || ask.isPending}>
              Ask
            </PrimaryButton>
          </form>
          <p className="text-xs text-slate-400 mt-2">
            AI-generated insights — please verify against your records before making business decisions.
          </p>
        </div>
      </div>

      {ask.isError && (
        <div className="mt-3">
          <ErrorAlert message={apiErrorMessage(ask.error)} onRetry={() => ask.reset()} />
        </div>
      )}
    </div>
  )
}
