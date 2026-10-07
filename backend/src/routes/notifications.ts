import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { pagination } from '../schemas/common'
import { checkOverdueInvoices } from '../services/notifications'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

router.get('/', async (req, res, next) => {
  try {
    const { take, skip } = pagination.parse(req.query)
    const organizationId = req.member!.organizationId
    const unreadOnly = req.query.unread === 'true'

    // Opportunistic overdue sweep: no scheduler needed for correctness.
    await checkOverdueInvoices(prisma, organizationId)

    const where: Record<string, unknown> = { organizationId }
    if (unreadOnly) where.isRead = false
    const [notifications, unreadCount, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { organizationId, isRead: false } }),
      prisma.notification.count({ where }),
    ])
    res.json({ notifications, unreadCount, total, take, skip })
  } catch (e) {
    next(e)
  }
})

router.patch('/:id/read', async (req, res, next) => {
  try {
    const note = await prisma.notification.findFirst({
      where: { id: String(req.params.id), organizationId: req.member!.organizationId },
    })
    if (!note) throw new AppError(404, 'NOT_FOUND', 'Notification not found')
    const updated = await prisma.notification.update({
      where: { id: note.id },
      data: { isRead: true },
    })
    res.json(updated)
  } catch (e) {
    next(e)
  }
})

// PATCH /api/notifications/read-all — mark every notification read
router.patch('/read-all', async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { organizationId: req.member!.organizationId, isRead: false },
      data: { isRead: true },
    })
    res.json({ ok: true, markedRead: result.count })
  } catch (e) {
    next(e)
  }
})

export default router
