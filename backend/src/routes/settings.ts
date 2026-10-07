import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { updateOrganizationSchema, updateSettingsSchema } from '../schemas/entities'
import { logAudit } from '../services/audit'

const router = Router()
router.use(authenticate)

router.get('/', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    let settings = await prisma.businessSetting.findUnique({ where: { organizationId } })
    if (!settings) {
      settings = await prisma.businessSetting.create({ data: { organizationId } })
    }
    res.json(settings)
  } catch (e) {
    next(e)
  }
})

router.patch('/', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const input = updateSettingsSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const settings = await prisma.businessSetting.upsert({
      where: { organizationId },
      create: { organizationId, ...input },
      update: input,
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'BusinessSetting',
      entityId: settings.id,
      details: input,
    })
    res.json(settings)
  } catch (e) {
    next(e)
  }
})

// GET /api/settings/profile — business profile (name, address, city, ...).
// Any authenticated member can view; only settings.manage can edit.
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.member!.organizationId },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        province: true,
        country: true,
        phone: true,
        email: true,
        website: true,
        category: true,
      },
    })
    if (!organization) throw new Error('Organization not found')
    res.json(organization)
  } catch (e) {
    next(e)
  }
})

router.patch('/profile', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const input = updateOrganizationSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...input,
        website: input.website === '' ? null : input.website,
      },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      actorName: req.member!.name,
      action: 'UPDATE',
      entity: 'Organization',
      entityId: organization.id,
      details: { name: input.name ?? organization.name },
    })
    res.json(organization)
  } catch (e) {
    next(e)
  }
})

export default router
