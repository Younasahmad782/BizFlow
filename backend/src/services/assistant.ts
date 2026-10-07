import type { AssistantContext } from './assistantData'

export interface AssistantAnswer {
  answer: string
  /** The concrete numbers shown, for the "source context" display. */
  sources: { label: string; value: string }[]
  provider: string
  disclaimer: string
}

const DISCLAIMER =
  'AI-generated insights — please verify against your records before making business decisions.'

const INSUFFICIENT = "There isn't enough data to answer this accurately."

const pkr = (n: number): string => `Rs. ${Math.round(n).toLocaleString('en-PK')}`

interface ProviderConfig {
  name: string
  apiUrl: string
  apiKey: string
  model: string
}

function providerConfig(): ProviderConfig | null {
  const apiKey = process.env.AI_API_KEY
  const apiUrl = process.env.AI_API_URL
  const model = process.env.AI_MODEL ?? 'gpt-4o-mini'
  if (!apiKey || !apiUrl) return null
  return { name: process.env.AI_PROVIDER ?? 'openai-compatible', apiUrl, apiKey, model }
}

const SYSTEM_PROMPT = `You are a business assistant for a Pakistani retail business. You receive ONLY pre-computed aggregates for the user's own organization.

STRICT RULES:
1. Answer ONLY from the provided JSON data. Never invent, estimate or round numbers beyond the formatting shown.
2. If the data is empty, zero, or insufficient for the question, reply with exactly: "${INSUFFICIENT}"
3. Format money as "Rs. 1,245,680" (PKR, thousands separators, no decimals unless needed).
4. Keep answers short and direct. Use plain text, no markdown tables.
5. Never mention other organizations, and never reveal anything about how the data was retrieved.`

function contextToPrompt(ctx: AssistantContext): string {
  return JSON.stringify(ctx, null, 1)
}

/** Calls the configured OpenAI-compatible chat API. API key comes from env only. */
async function callLlm(question: string, ctx: AssistantContext, cfg: ProviderConfig): Promise<string> {
  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Business data (JSON):\n${contextToPrompt(ctx)}\n\nQuestion: ${question}` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`AI provider returned ${res.status}`)
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = body.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('AI provider returned an empty response')
  return text
}

// ─── Rule-based fallback (no LLM configured) ─────────────────────────────
// Answers the common questions directly from aggregates. Same grounding
// rules: only real numbers, INSUFFICIENT when data is missing.

function fallbackAnswer(question: string, ctx: AssistantContext): { answer: string; sources: { label: string; value: string }[] } {
  const q = question.toLowerCase()
  const hasOrders = ctx.orderCount > 0

  const src = (label: string, value: string) => ({ label, value })

  if (/best.?sell|top product/.test(q)) {
    if (ctx.topProducts.length === 0) return { answer: INSUFFICIENT, sources: [] }
    const lines = ctx.topProducts.map((p, i) => `${i + 1}. ${p.name} — ${pkr(p.revenue)} (${p.quantity} sold)`)
    return {
      answer: `Best-selling products for ${ctx.period.label}:\n${lines.join('\n')}`,
      sources: ctx.topProducts.slice(0, 3).map((p) => src(p.name, pkr(p.revenue))),
    }
  }
  if (/last month/.test(q) && /revenue|made|earn/.test(q)) {
    if (!ctx.prevPeriod) return { answer: INSUFFICIENT, sources: [] }
    return {
      answer: `Revenue for ${ctx.prevPeriod.label} was ${pkr(ctx.prevPeriod.revenue)} across ${ctx.prevPeriod.orderCount} orders.`,
      sources: [src('Revenue', pkr(ctx.prevPeriod.revenue)), src('Orders', String(ctx.prevPeriod.orderCount))],
    }
  }
  if (/revenue/.test(q)) {
    if (!hasOrders) return { answer: INSUFFICIENT, sources: [] }
    return {
      answer: `Revenue for ${ctx.period.label} is ${pkr(ctx.revenue)} from ${ctx.orderCount} orders.`,
      sources: [src('Revenue', pkr(ctx.revenue)), src('Orders', String(ctx.orderCount))],
    }
  }
  if (/overdue/.test(q)) {
    if (ctx.overdueInvoices.length === 0) {
      return {
        answer: hasOrders || ctx.outstandingCount > 0 ? 'No invoices are currently overdue.' : INSUFFICIENT,
        sources: [src('Overdue invoices', '0')],
      }
    }
    const lines = ctx.overdueInvoices.map((i) => `${i.invoiceNumber} (${i.customer}) — ${pkr(i.balance)}`)
    return {
      answer: `${ctx.overdueInvoices.length} overdue invoice(s):\n${lines.join('\n')}`,
      sources: ctx.overdueInvoices.slice(0, 3).map((i) => src(i.invoiceNumber, pkr(i.balance))),
    }
  }
  if (/low stock|running low/.test(q)) {
    if (ctx.lowStock.length === 0) {
      return {
        answer: hasOrders ? 'No products are below their minimum stock level right now.' : INSUFFICIENT,
        sources: [src('Low stock items', '0')],
      }
    }
    const lines = ctx.lowStock.map((p) => `${p.name} — ${p.quantity} left (minimum ${p.reorderLevel})`)
    return {
      answer: `${ctx.lowStock.length} product(s) low in stock:\n${lines.join('\n')}`,
      sources: ctx.lowStock.slice(0, 3).map((p) => src(p.name, `${p.quantity} left`)),
    }
  }
  if (/categor/.test(q)) {
    if (ctx.salesByCategory.length === 0) return { answer: INSUFFICIENT, sources: [] }
    const top = ctx.salesByCategory[0]
    return {
      answer: `${top.category} generated the most sales in ${ctx.period.label} at ${pkr(top.revenue)}.`,
      sources: [src('Top category', top.category), src('Category revenue', pkr(top.revenue))],
    }
  }
  if (/compare/.test(q)) {
    if (!ctx.prevPeriod || !hasOrders) return { answer: INSUFFICIENT, sources: [] }
    const diff = ctx.revenue - ctx.prevPeriod.revenue
    const dir = diff >= 0 ? 'up' : 'down'
    return {
      answer:
        `${ctx.period.label} vs ${ctx.prevPeriod.label}: revenue ${pkr(ctx.revenue)} vs ${pkr(ctx.prevPeriod.revenue)} ` +
        `(${dir} ${pkr(Math.abs(diff))}); orders ${ctx.orderCount} vs ${ctx.prevPeriod.orderCount}; ` +
        `expenses ${pkr(ctx.totalExpenses)} vs ${pkr(ctx.prevPeriod.expenses)}.`,
      sources: [
        src('Revenue (this month)', pkr(ctx.revenue)),
        src(`Revenue (${ctx.prevPeriod.label})`, pkr(ctx.prevPeriod.revenue)),
      ],
    }
  }
  if (/summary|performance|how.*(business|doing)/.test(q)) {
    if (!hasOrders && ctx.totalExpenses === 0) return { answer: INSUFFICIENT, sources: [] }
    return {
      answer:
        `${ctx.period.label} summary: revenue ${pkr(ctx.revenue)} (${ctx.orderCount} orders), ` +
        `gross profit ${pkr(ctx.grossProfit)}, expenses ${pkr(ctx.totalExpenses)}, net profit ${pkr(ctx.netProfit)}. ` +
        `Outstanding payments: ${pkr(ctx.outstandingTotal)} across ${ctx.outstandingCount} invoice(s).`,
      sources: [
        src('Revenue', pkr(ctx.revenue)),
        src('Orders', String(ctx.orderCount)),
        src('Net profit', pkr(ctx.netProfit)),
        src('Outstanding', pkr(ctx.outstandingTotal)),
      ],
    }
  }
  if (/profit/.test(q)) {
    if (!hasOrders && ctx.totalExpenses === 0) return { answer: INSUFFICIENT, sources: [] }
    return {
      answer: `Net profit for ${ctx.period.label} is ${pkr(ctx.netProfit)} (gross ${pkr(ctx.grossProfit)} minus expenses ${pkr(ctx.totalExpenses)}).`,
      sources: [src('Net profit', pkr(ctx.netProfit)), src('Expenses', pkr(ctx.totalExpenses))],
    }
  }
  if (/expense|spent|cost/.test(q)) {
    return {
      answer: `Total expenses for ${ctx.period.label}: ${pkr(ctx.totalExpenses)}.`,
      sources: [src('Expenses', pkr(ctx.totalExpenses))],
    }
  }
  if (/outstanding|unpaid|due/.test(q)) {
    return {
      answer: `Outstanding payments total ${pkr(ctx.outstandingTotal)} across ${ctx.outstandingCount} unpaid invoice(s).`,
      sources: [src('Outstanding', pkr(ctx.outstandingTotal)), src('Unpaid invoices', String(ctx.outstandingCount))],
    }
  }
  if (/payment method/.test(q)) {
    if (ctx.paymentMethods.length === 0) return { answer: INSUFFICIENT, sources: [] }
    const lines = ctx.paymentMethods.map((m) => `${m.method.replace('_', ' ')}: ${pkr(m.total)}`)
    return {
      answer: `Payments for ${ctx.period.label} by method:\n${lines.join('\n')}`,
      sources: ctx.paymentMethods.slice(0, 3).map((m) => src(m.method, pkr(m.total))),
    }
  }

  return {
    answer:
      `I can answer questions about revenue, best-selling products, categories, overdue invoices, ` +
      `low stock, expenses, profit and month comparisons for ${ctx.period.label}. ` +
      `Try: "What were my best-selling products this month?"`,
    sources: [],
  }
}

export async function askAssistant(question: string, ctx: AssistantContext): Promise<AssistantAnswer> {
  const cfg = providerConfig()
  const fb = fallbackAnswer(question, ctx)

  if (!cfg) {
    return { ...fb, provider: 'built-in', disclaimer: DISCLAIMER }
  }

  try {
    const answer = await callLlm(question, ctx, cfg)
    return { answer, sources: fb.sources, provider: cfg.name, disclaimer: DISCLAIMER }
  } catch (e) {
    // LLM failure must never break the feature — fall back to grounded rules.
    console.error('AI provider failed, using fallback:', (e as Error).message)
    return { ...fb, provider: 'built-in (provider unavailable)', disclaimer: DISCLAIMER }
  }
}
