import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { buildAssistantContext } from '../services/assistantData'
import { askAssistant } from '../services/assistant'
import { logAudit } from '../services/audit'

const router = Router()
router.use(authenticate)

const askSchema = z.object({
  question: z.string().trim().min(3).max(500),
  monthOffset: z.number().int().min(0).max(11).optional().default(0),
})

// POST /api/assistant/ask — the organizationId ALWAYS comes from the
// authenticated session. The AI receives only the aggregates built by
// buildAssistantContext for that org — never raw DB access, never another
// organization's data.
router.post('/ask', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const input = askSchema.parse(req.body)
    const organizationId = req.member!.organizationId

    const ctx = await buildAssistantContext(organizationId, input.monthOffset)
    const result = await askAssistant(input.question, ctx)

    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      actorName: req.member!.name,
      action: 'CREATE',
      entity: 'AssistantQuery',
      details: { question: input.question.slice(0, 200), provider: result.provider },
    })

    res.json({
      answer: result.answer,
      sources: result.sources,
      provider: result.provider,
      period: ctx.period.label,
      disclaimer: result.disclaimer,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/assistant/context — lets the UI show "what the AI can see".
router.get('/context', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const ctx = await buildAssistantContext(req.member!.organizationId, 0)
    res.json({
      period: ctx.period.label,
      orderCount: ctx.orderCount,
      revenue: ctx.revenue,
      topProductCount: ctx.topProducts.length,
      lowStockCount: ctx.lowStock.length,
      overdueCount: ctx.overdueInvoices.length,
    })
  } catch (e) {
    next(e)
  }
})

export default router
